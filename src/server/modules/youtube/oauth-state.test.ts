import { describe, expect, it } from 'vitest';
import { OAuthStateStore } from './oauth';

describe('OAuth state store', () => {
  it('binds state to a profile, expires it, and consumes it only once', () => {
    let now = 1_000;
    const store = new OAuthStateStore(() => now, 600_000);
    store.put('state-a', 'profile-a', 'verifier-a');
    expect(store.take('state-b')).toBeNull();
    expect(store.take('state-a')).toEqual({ profileId: 'profile-a', verifier: 'verifier-a', expiresAt: 601_000 });
    expect(store.take('state-a')).toBeNull();
    store.put('state-expired', 'profile-b', 'verifier-b');
    now += 600_001;
    expect(store.take('state-expired')).toBeNull();
  });
});
