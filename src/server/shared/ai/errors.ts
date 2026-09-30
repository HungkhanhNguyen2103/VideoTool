import { loadConfig } from '../../config';
import { AppError } from '../errors';

export type AiProviderName = 'DeepSeek' | 'Claude';

const ENDPOINT_BY_PROVIDER: Record<AiProviderName, string> = {
  DeepSeek: 'api.deepseek.com',
  Claude: 'api.anthropic.com',
};

export class AiRequestError extends AppError {
  constructor(
    readonly provider: AiProviderName,
    status: number,
    message: string,
  ) {
    super(message, status, 'AI_REQUEST_FAILED');
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }).status
    ?? (error as { statusCode?: unknown }).statusCode
    ?? (error as { response?: { status?: unknown } }).response?.status;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const name = (error as { name?: unknown }).name;
  const message = error instanceof Error ? error.message : String(error);
  return [code, name, message].some((value) => typeof value === 'string' && /timeout|timed out|ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|network|fetch failed|socket hang up/i.test(value));
}

export function normalizeAiError(provider: AiProviderName, error: unknown): AiRequestError {
  if (error instanceof AiRequestError) return error;
  const status = statusOf(error);
  const suffix = status === undefined ? '' : ` (HTTP ${status})`;
  if (status === 401) return new AiRequestError(provider, status, `${provider} API key invalid${suffix}.`);
  if (status === 402) return new AiRequestError(provider, status, `${provider} balance insufficient${suffix}.`);
  if (status === 429) return new AiRequestError(provider, status, `${provider} API rate limited${suffix}.`);
  if (isNetworkFailure(error)) return new AiRequestError(provider, 502, `Cannot reach ${ENDPOINT_BY_PROVIDER[provider]} (timeout/network).`);
  return new AiRequestError(provider, status ?? 502, `${provider} API request failed${suffix}.`);
}

export function aiRequestTimeoutMs(): number {
  return loadConfig().AI_REQUEST_TIMEOUT_MS;
}

export function withAiRequestTimeout<T>(operation: () => Promise<T>, timeoutMs = aiRequestTimeoutMs()): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(Object.assign(new Error('AI request timed out.'), { code: 'ETIMEDOUT' }))), timeoutMs);
    timer.unref();
    try {
      operation().then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
