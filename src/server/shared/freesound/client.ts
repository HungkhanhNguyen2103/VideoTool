import { loadConfig } from '../../config';
import { logger } from '../logger';
import { extractSearchQueries } from './keyword-map';
import { rankSfxCandidates, type FreesoundSoundCandidate } from './sound-picker';

export type FreesoundSfxReason = 'ok' | 'no-results' | 'rate-limited' | 'http-error' | 'download-error' | 'empty-query';
export type FreesoundSfxResult = {
  audio: Buffer | null;
  reason: FreesoundSfxReason;
  sound: FreesoundSoundCandidate | null;
  query?: string;
  detail?: string;
};

export interface FreesoundClient {
  /** Compatible legacy result for any older callers. */
  searchAndDownloadSfx(prompt: string): Promise<Buffer | null>;
  /** SFX selector with an explicit per-scene outcome and chosen sound metadata. */
  searchSfx(prompt: string): Promise<FreesoundSfxResult>;
  searchAndDownloadBgm(mood: string): Promise<Buffer | null>;
}

type FreesoundClientOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  dailyRequestLimit?: number;
};

type FetchFailure = 'rate-limited' | 'http-error' | 'download-error';
type FetchResult = { response: Response; reason?: never } | { response?: never; reason: FetchFailure; detail?: string };
type SearchPayload = { results?: unknown };

// Freesound docs deprecate this endpoint, but keep it until a real request validates /search/ parameters.
const FREESOUND_SEARCH_ENDPOINT = 'https://freesound.org/apiv2/search/text/';
const API_REQUEST_INTERVAL_MS = 1100;
const MAX_ATTEMPTS = 3;
const MAX_DAILY_API_REQUESTS = 2000;
const API_RATE_LIMIT_QUERY_EXCLUSIONS = '-speech -voice -vocal -talking -shout -scream -crowd -singing';
const SFX_FILTER = 'license:"Creative Commons 0" duration:[0.3 TO 8.0]';
const SFX_FIELDS = 'id,name,tags,duration,avg_rating,num_ratings,previews,license';

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response: Response, now: number): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function backoffMilliseconds(attempt: number, random: () => number): number {
  const jitter = Math.max(0, Math.min(1, random())) * 250;
  return (500 * (2 ** (attempt - 1))) + jitter;
}

function isSoundCandidate(value: unknown): value is FreesoundSoundCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FreesoundSoundCandidate>;
  return typeof candidate.id === 'number'
    && typeof candidate.name === 'string'
    && Array.isArray(candidate.tags)
    && candidate.tags.every((tag) => typeof tag === 'string')
    && typeof candidate.duration === 'number'
    && typeof candidate.avg_rating === 'number'
    && typeof candidate.num_ratings === 'number'
    && Boolean(candidate.previews && typeof candidate.previews === 'object');
}

function previewUrl(candidate: FreesoundSoundCandidate): string | null {
  const value = candidate.previews['preview-hq-mp3'] ?? candidate.previews['preview-lq-mp3'];
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function createFreesoundClient(options: FreesoundClientOptions): FreesoundClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const dailyRequestLimit = options.dailyRequestLimit ?? MAX_DAILY_API_REQUESTS;
  let nextApiRequestAt = 0;
  let limiterQueue = Promise.resolve();
  let requestDay = '';
  let apiRequestsToday = 0;

  async function reserveApiRequest(): Promise<boolean> {
    const previous = limiterQueue;
    let release: () => void = () => {};
    limiterQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      let current = now();
      let day = new Date(current).toISOString().slice(0, 10);
      if (day !== requestDay) {
        requestDay = day;
        apiRequestsToday = 0;
      }
      if (apiRequestsToday >= dailyRequestLimit) return false;

      const wait = Math.max(0, nextApiRequestAt - current);
      if (wait > 0) await sleep(wait);
      current = now();
      day = new Date(current).toISOString().slice(0, 10);
      if (day !== requestDay) {
        requestDay = day;
        apiRequestsToday = 0;
      }
      if (apiRequestsToday >= dailyRequestLimit) return false;
      apiRequestsToday += 1;
      nextApiRequestAt = current + API_REQUEST_INTERVAL_MS;
      return true;
    } finally {
      release();
    }
  }

  async function fetchWithRetry(url: string | URL, init: RequestInit, kind: 'api' | 'download'): Promise<FetchResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (kind === 'api' && !(await reserveApiRequest())) {
        return { reason: 'rate-limited', detail: 'Freesound daily API request budget exhausted.' };
      }
      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn(`Freesound ${kind} request failed after ${attempt} attempts.`);
          return { reason: kind === 'api' ? 'http-error' : 'download-error', detail: 'Network request failed.' };
        }
        await sleep(backoffMilliseconds(attempt, random));
        continue;
      }

      if (response.ok) return { response };
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) return { reason: kind === 'api' ? 'http-error' : 'download-error', detail: `HTTP ${response.status}.` };
      if (attempt === MAX_ATTEMPTS) {
        return { reason: response.status === 429 ? 'rate-limited' : kind === 'api' ? 'http-error' : 'download-error', detail: `HTTP ${response.status} after ${attempt} attempts.` };
      }
      const retryAfter = response.status === 429 ? retryAfterMilliseconds(response, now()) : null;
      await sleep(Math.max(retryAfter ?? 0, backoffMilliseconds(attempt, random)));
    }
    return { reason: kind === 'api' ? 'http-error' : 'download-error', detail: 'Request attempts exhausted.' };
  }

  async function searchAndDownload(query: string, filter: string, fields: string, pageSize: number): Promise<Buffer | null> {
    if (!query || !options.apiKey) return null;
    const url = new URL(FREESOUND_SEARCH_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('filter', filter);
    url.searchParams.set('sort', 'rating_desc');
    url.searchParams.set('page_size', String(pageSize));
    url.searchParams.set('fields', fields);
    const search = await fetchWithRetry(url, { headers: { accept: 'application/json', Authorization: `Token ${options.apiKey}` } }, 'api');
    if (!search.response) return null;
    try {
      const payload = await search.response.json() as SearchPayload;
      const result = Array.isArray(payload.results) ? payload.results[0] as { previews?: Record<string, unknown> } | undefined : undefined;
      const selectedUrl = typeof result?.previews?.['preview-hq-mp3'] === 'string'
        ? result.previews['preview-hq-mp3']
        : typeof result?.previews?.['preview-lq-mp3'] === 'string' ? result.previews['preview-lq-mp3'] : null;
      if (!selectedUrl) return null;
      const download = await fetchWithRetry(selectedUrl, {}, 'download');
      return download.response ? Buffer.from(await download.response.arrayBuffer()) : null;
    } catch {
      logger.warn('Freesound response could not be read.');
      return null;
    }
  }

  async function searchSfx(prompt: string): Promise<FreesoundSfxResult> {
    if (!options.apiKey) return { audio: null, reason: 'http-error', sound: null, detail: 'Freesound API key is missing.' };
    const queries = extractSearchQueries(prompt);
    if (queries.length === 0) return { audio: null, reason: 'empty-query', sound: null };

    let lastReason: FreesoundSfxReason = 'no-results';
    let lastDetail: string | undefined;
    for (const query of queries) {
      const url = new URL(FREESOUND_SEARCH_ENDPOINT);
      url.searchParams.set('query', `${query} ${API_RATE_LIMIT_QUERY_EXCLUSIONS}`);
      url.searchParams.set('filter', SFX_FILTER);
      url.searchParams.set('sort', 'rating_desc');
      url.searchParams.set('page_size', '15');
      url.searchParams.set('fields', SFX_FIELDS);

      const search = await fetchWithRetry(url, { headers: { accept: 'application/json', Authorization: `Token ${options.apiKey}` } }, 'api');
      if (!search.response) {
        lastReason = search.reason;
        lastDetail = search.detail;
        if (search.reason === 'rate-limited') return { audio: null, reason: lastReason, sound: null, query, detail: lastDetail };
        continue;
      }

      let candidates: FreesoundSoundCandidate[];
      try {
        const payload = await search.response.json() as SearchPayload;
        if (!Array.isArray(payload.results)) {
          lastReason = 'http-error';
          lastDetail = 'Malformed search response.';
          continue;
        }
        candidates = payload.results.filter(isSoundCandidate);
      } catch {
        lastReason = 'http-error';
        lastDetail = 'Malformed search JSON.';
        continue;
      }

      const rankedCandidates = rankSfxCandidates(candidates, query);
      if (rankedCandidates.length === 0) continue;
      for (const selected of rankedCandidates) {
        const urlToDownload = previewUrl(selected);
        if (!urlToDownload) continue;
        const downloaded = await fetchWithRetry(urlToDownload, {}, 'download');
        if (!downloaded.response) {
          lastReason = downloaded.reason;
          lastDetail = downloaded.detail;
          if (downloaded.reason === 'rate-limited') return { audio: null, reason: 'rate-limited', sound: null, query, detail: lastDetail };
          continue;
        }
        try {
          const audio = Buffer.from(await downloaded.response.arrayBuffer());
          if (audio.length === 0) {
            lastReason = 'download-error';
            lastDetail = 'Preview was empty.';
            continue;
          }
          return { audio, reason: 'ok', sound: selected, query };
        } catch {
          lastReason = 'download-error';
          lastDetail = 'Preview could not be read.';
        }
      }
    }
    return { audio: null, reason: lastReason, sound: null, detail: lastDetail };
  }

  return {
    async searchAndDownloadSfx(prompt) {
      const result = await searchSfx(prompt);
      return result.reason === 'ok' ? result.audio : null;
    },
    searchSfx,
    async searchAndDownloadBgm(mood) {
      return searchAndDownload(`${mood.trim()} ambient cinematic music`, 'duration:[30.0 TO 240.0]', 'previews', 1);
    },
  };
}

let singleton: FreesoundClient | null = null;
export function getFreesoundClient(): FreesoundClient {
  if (!singleton) singleton = createFreesoundClient({ apiKey: loadConfig().FREESOUND_API_KEY });
  return singleton;
}
