import path from 'node:path';
import { loadConfig } from '../../config';
import { AppError } from '../errors';
import { logger } from '../logger';
import type { TtsClient, TtsOptions } from './types';

type VieneuClientOptions = {
  apiUrl: string;
  defaultVoice: string;
  defaultRefAudioPath?: string;
  defaultRefAudioText?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function responseErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) return `TTS server returned ${response.status}: ${parsed.detail}`;
  } catch {
    // Fall through to the status-only message for a non-JSON response.
  }
  return `TTS server returned ${response.status}.`;
}

export function createVieneuClient(options: VieneuClientOptions): TtsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  async function synthesize(text: string, opts: TtsOptions = {}): Promise<Buffer> {
    const body = {
      text,
      voice: opts.voice ?? options.defaultVoice,
      ref_audio_path: opts.refAudioPath ?? options.defaultRefAudioPath ?? null,
      ref_audio_text: opts.refAudioText ?? options.defaultRefAudioText ?? null,
      speed: opts.speed ?? 1.0,
      temperature: opts.temperature ?? 0.3,
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetchImpl(options.apiUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const message = await responseErrorMessage(response);
          const error = new Error(message);
          Object.assign(error, { retryable: response.status >= 500 });
          throw error;
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof Error) || (error as Error & { retryable?: boolean }).retryable !== false;
        if (attempt === 0 && retryable) await sleep(1_500);
        else if (!retryable) break;
      } finally {
        clearTimeout(timer);
      }
    }
    logger.warn('VieNeu TTS request failed.', lastError);
    const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
    throw new AppError(`VieNeu TTS request failed.${detail}`, 502, 'TTS_REQUEST_FAILED');
  }

  return { synthesize };
}

let singleton: TtsClient | null = null;
export function getTtsClient(): TtsClient {
  if (!singleton) {
    const config = loadConfig();
    singleton = createVieneuClient({
      apiUrl: config.TTS_API_URL,
      defaultVoice: config.TTS_DEFAULT_VOICE,
      defaultRefAudioPath: path.resolve(config.TTS_REF_AUDIO_PATH),
      defaultRefAudioText: config.TTS_REF_AUDIO_TEXT,
      timeoutMs: config.TTS_TIMEOUT_MS,
    });
  }
  return singleton;
}
