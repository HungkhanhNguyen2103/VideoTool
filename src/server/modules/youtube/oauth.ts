import { createHash, randomBytes } from 'node:crypto';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
] as const;

export type PkcePair = { verifier: string; challenge: string };

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function createOauthState(): string {
  return randomBytes(32).toString('base64url');
}

export type PendingOAuthState =
  | { mode: 'profile'; profileId: string; verifier: string; expiresAt: number; redirectUri?: string; openerOrigin?: string }
  | { mode: 'import'; verifier: string; expiresAt: number; redirectUri?: string; openerOrigin?: string };

export class OAuthStateStore {
  private readonly states = new Map<string, PendingOAuthState>();

  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 10 * 60_000) {}

  put(state: string, profileId: string, verifier: string, redirectUri?: string, openerOrigin?: string): void {
    this.states.set(state, { mode: 'profile', profileId, verifier, expiresAt: this.now() + this.ttlMs, ...(redirectUri ? { redirectUri } : {}), ...(openerOrigin ? { openerOrigin } : {}) });
    this.removeExpired();
  }

  putImport(state: string, verifier: string, redirectUri?: string, openerOrigin?: string): void {
    this.states.set(state, { mode: 'import', verifier, expiresAt: this.now() + this.ttlMs, ...(redirectUri ? { redirectUri } : {}), ...(openerOrigin ? { openerOrigin } : {}) });
    this.removeExpired();
  }

  private removeExpired(): void {
    for (const [key, value] of this.states) if (value.expiresAt < this.now()) this.states.delete(key);
  }

  take(state: string | undefined): PendingOAuthState | null {
    if (!state) return null;
    const pending = this.states.get(state);
    this.states.delete(state);
    return pending && pending.expiresAt >= this.now() ? pending : null;
  }

  peek(state: string | undefined): PendingOAuthState | null {
    if (!state) return null;
    const pending = this.states.get(state);
    if (!pending) return null;
    if (pending.expiresAt < this.now()) {
      this.states.delete(state);
      return null;
    }
    return pending;
  }
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  pkce: PkcePair;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

const OAUTH_SECRET_KEYS = 'access_token|refresh_token|id_token|code|client_secret';

/** Remove OAuth secrets from provider messages before they can reach any log or API error. */
export function redactOAuthSecrets(input: string): string {
  const pattern = new RegExp(`((?:${OAUTH_SECRET_KEYS})\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s&,;]+)`, 'gi');
  return input.replace(pattern, '$1[REDACTED]');
}

export type OAuthTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export class YoutubeOAuthError extends Error {
  constructor(message: string, readonly providerCode?: string) {
    super(message);
    this.name = 'YoutubeOAuthError';
  }
}

async function tokenRequest(body: URLSearchParams, fetcher: typeof fetch): Promise<OAuthTokenResponse> {
  let response: Response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    throw new YoutubeOAuthError('Google OAuth is temporarily unavailable.');
  }
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof value.access_token !== 'string' || typeof value.expires_in !== 'number') {
    const code = typeof value.error === 'string' ? value.error : undefined;
    const safeDetail = redactOAuthSecrets(JSON.stringify(value));
    throw new YoutubeOAuthError(`Google OAuth request failed (${safeDetail.slice(0, 300)}).`, code);
  }
  return value as unknown as OAuthTokenResponse;
}

export function exchangeAuthorizationCode(input: {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    code: input.code,
    code_verifier: input.verifier,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });
  return tokenRequest(body, input.fetcher ?? fetch);
}

export function refreshAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
  });
  return tokenRequest(body, input.fetcher ?? fetch);
}

export async function revokeGoogleToken(token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    // Revocation is best-effort; local credentials are removed regardless.
    return false;
  }
}
