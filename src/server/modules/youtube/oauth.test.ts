import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationUrl,
  createPkcePair,
  redactOAuthSecrets,
  YOUTUBE_SCOPES,
} from './oauth';

describe('YouTube OAuth primitives', () => {
  it('requests exactly the two read-only scopes', () => {
    expect(YOUTUBE_SCOPES).toEqual([
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ]);
  });

  it('builds PKCE authorization parameters without write scopes', () => {
    const pkce = createPkcePair();
    const url = new URL(buildAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'http://localhost:3000/api/youtube/oauth/callback',
      state: 'state-value',
      pkce,
    }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(YOUTUBE_SCOPES);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('redacts OAuth secrets in both key-value logs and URL-like errors', () => {
    const redacted = redactOAuthSecrets('refresh_token=refresh-secret code=auth-secret client_secret=client-secret');
    expect(redacted).not.toContain('refresh-secret');
    expect(redacted).not.toContain('auth-secret');
    expect(redacted).not.toContain('client-secret');
    expect(redacted.match(/\[REDACTED\]/g)).toHaveLength(3);
  });
});
