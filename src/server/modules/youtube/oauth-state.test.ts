import { describe, expect, it } from 'vitest';
import { OAuthStateStore } from './oauth';

describe('OAuth state store', () => {
  it('binds state to a profile, expires it, and consumes it only once', () => {
    let now = 1_000;
    const store = new OAuthStateStore(() => now, 600_000);
    store.put('state-a', 'profile-a', 'verifier-a');
    expect(store.take('state-b')).toBeNull();
    expect(store.take('state-a')).toEqual({ mode: 'profile', profileId: 'profile-a', verifier: 'verifier-a', expiresAt: 601_000 });
    expect(store.take('state-a')).toBeNull();
    store.put('state-expired', 'profile-b', 'verifier-b');
    now += 600_001;
    expect(store.take('state-expired')).toBeNull();
  });

  it('binds import state to the import mode without a profile id', () => {
    const store = new OAuthStateStore(() => 1_000, 600_000);
    store.putImport('import-state', 'import-verifier', 'http://localhost:3000/api/youtube/oauth/callback', 'http://localhost:5173');
    expect(store.take('import-state')).toEqual({
      mode: 'import',
      verifier: 'import-verifier',
      redirectUri: 'http://localhost:3000/api/youtube/oauth/callback',
      openerOrigin: 'http://localhost:5173',
      expiresAt: 601_000,
    });
    expect(store.take('import-state')).toBeNull();
  });
});
