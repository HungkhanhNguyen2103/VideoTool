import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedRefreshToken = { algorithm: 'aes-256-gcm'; iv: string; authTag: string; ciphertext: string };

function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32 || key.toString('base64') !== base64Key) {
    throw new Error('YOUTUBE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function encryptRefreshToken(token: string, base64Key: string): EncryptedRefreshToken {
  const key = parseKey(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptRefreshToken(value: EncryptedRefreshToken, base64Key: string): string {
  if (value.algorithm !== 'aes-256-gcm') throw new Error('Unsupported YouTube credential encryption.');
  const decipher = createDecipheriv('aes-256-gcm', parseKey(base64Key), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function randomSelectionId(): string {
  return randomBytes(24).toString('base64url');
}
