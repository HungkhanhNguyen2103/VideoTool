import { describe, expect, it } from 'vitest';
import { decryptRefreshToken, encryptRefreshToken } from './credentials-store';

describe('encrypted YouTube refresh token storage', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('round-trips ciphertext and never stores the token as plaintext', () => {
    const encrypted = encryptRefreshToken('refresh-token-secret', key);
    expect(encrypted.ciphertext).not.toContain('refresh-token-secret');
    expect(JSON.stringify(encrypted)).not.toContain('refresh-token-secret');
    expect(decryptRefreshToken(encrypted, key)).toBe('refresh-token-secret');
  });

  it('fails safely with a wrong key or an invalid key length', () => {
    const encrypted = encryptRefreshToken('refresh-token-secret', key);
    expect(() => decryptRefreshToken(encrypted, Buffer.alloc(32, 8).toString('base64'))).toThrow();
    expect(() => encryptRefreshToken('refresh-token-secret', Buffer.alloc(31).toString('base64'))).toThrow();
  });
});
