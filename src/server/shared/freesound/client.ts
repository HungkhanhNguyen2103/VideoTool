import { loadConfig } from '../../config';
import { logger } from '../logger';
import { extractSearchQueries } from './keyword-map';

export interface FreesoundClient {
  searchAndDownloadSfx(prompt: string): Promise<Buffer | null>;
  searchAndDownloadBgm(mood: string): Promise<Buffer | null>;
}

type FreesoundClientOptions = { apiKey: string; fetchImpl?: typeof fetch };
const SEARCH_URL = 'https://freesound.org/apiv2/search/text/';

export function createFreesoundClient(options: FreesoundClientOptions): FreesoundClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function searchAndDownload(query: string, filter: string): Promise<Buffer | null> {
    if (!query || !options.apiKey) return null;
    try {
      const url = new URL(SEARCH_URL);
      url.searchParams.set('query', query);
      url.searchParams.set('token', options.apiKey);
      url.searchParams.set('filter', filter);
      url.searchParams.set('sort', 'rating_desc');
      url.searchParams.set('page_size', '1');
      const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Freesound search returned ${response.status}.`);
      const payload = await response.json() as { results?: Array<{ previews?: Record<string, unknown> }> };
      const preview = payload.results?.[0]?.previews;
      const previewUrl = typeof preview?.['preview-hq-mp3'] === 'string' ? preview['preview-hq-mp3'] : typeof preview?.['preview-lq-mp3'] === 'string' ? preview['preview-lq-mp3'] : null;
      if (!previewUrl) return null;
      const audio = await fetchImpl(previewUrl);
      if (!audio.ok) throw new Error(`Freesound preview returned ${audio.status}.`);
      return Buffer.from(await audio.arrayBuffer());
    } catch (error) {
      logger.warn('Freesound request failed; continuing without audio.', error);
      return null;
    }
  }

  return {
    async searchAndDownloadSfx(prompt) {
      for (const query of extractSearchQueries(prompt)) {
        const audio = await searchAndDownload(query, 'license:"Creative Commons 0" duration:[0.3 TO 8.0]');
        if (audio) return audio;
      }
      return null;
    },
    searchAndDownloadBgm: (mood) => searchAndDownload(`${mood.trim()} ambient cinematic music`, 'duration:[30.0 TO 240.0]'),
  };
}

let singleton: FreesoundClient | null = null;
export function getFreesoundClient(): FreesoundClient {
  if (!singleton) singleton = createFreesoundClient({ apiKey: loadConfig().FREESOUND_API_KEY });
  return singleton;
}
