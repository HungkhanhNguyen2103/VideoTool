import type { NameCandidates } from './project';

/** Stable, non-cryptographic content fingerprint for freshness checks across server and browser. */
export function hashNarration(narration: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(narration)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

export function areNameCandidatesFresh(
  record: NameCandidates | null | undefined,
  narration: string,
  audioFileId: string | null,
): record is NameCandidates {
  return Boolean(record && audioFileId && record.audioFileId === audioFileId && record.narrationHash === hashNarration(narration));
}
