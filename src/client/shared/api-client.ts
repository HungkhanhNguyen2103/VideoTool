import type { ZodType } from 'zod';
import { ApiErrorBodySchema } from '../../contracts/common';

/** Thrown for any non-2xx response. `.message` is safe to show to the user (Vietnamese). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields?: { path: string; message: string }[],
    readonly jobId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return new ApiError(`Yêu cầu thất bại (${res.status}).`, res.status, 'unknown_error');
  }
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (!parsed.success) return new ApiError(`Yêu cầu thất bại (${res.status}).`, res.status, 'unknown_error');
  return new ApiError(parsed.data.error.message, res.status, parsed.data.error.code, parsed.data.error.fields, parsed.data.error.jobId);
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
};

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Fetch wrapper: sends/receives JSON, parses the response with the given zod schema
 * and throws ApiError (readable Vietnamese message) for any non-2xx response.
 */
export async function apiRequest<T>(path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) throw await parseErrorBody(res);
  if (res.status === 204) return schema.parse(undefined);

  const json = await res.json();
  return schema.parse(json);
}
