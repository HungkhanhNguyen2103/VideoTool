export type WhisperWord = { word: string; start: number; end: number; probability: number };
export type TimedNarrationWord = { text: string; startSec: number; endSec: number };
export type WordAlignmentResult =
  | { words: TimedNarrationWord[]; matchedRatio: number; reason: null }
  | { words: null; matchedRatio: number; reason: string };

/** Reject alignment when fewer than 70% of narration tokens match Whisper words. */
export const MIN_WORD_ALIGNMENT_MATCH_RATIO = 0.7;

function normalize(value: string): string {
  return value.toLowerCase().replace(/đ/g, 'd').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

/** Align exact normalized tokens in order; Whisper insertions are discarded. */
export function alignNarrationWords(narration: string, rawWords: WhisperWord[], wavDurationSec: number): WordAlignmentResult {
  const tokens = narration.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || !Number.isFinite(wavDurationSec) || wavDurationSec <= 0) {
    return { words: null, matchedRatio: 0, reason: 'empty narration or invalid WAV duration' };
  }
  let previousEnd = 0;
  for (const word of rawWords) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previousEnd || word.end < word.start || word.end > wavDurationSec) {
      return { words: null, matchedRatio: 0, reason: 'negative, non-monotonic, or out-of-bounds Whisper span' };
    }
    previousEnd = word.end;
  }

  // A Whisper "word" may contain whitespace; distribute its span across its pieces.
  const transcript = rawWords.flatMap((word) => {
    const pieces = word.word.trim().split(/\s+/u).filter(Boolean);
    return pieces.map((piece, index) => ({
      normalized: normalize(piece),
      start: word.start + (word.end - word.start) * index / pieces.length,
      end: word.start + (word.end - word.start) * (index + 1) / pieces.length,
    }));
  }).filter((word) => word.normalized);
  const wanted = tokens.map(normalize);
  const rows = wanted.length + 1;
  const cols = transcript.length + 1;
  const dp = new Uint16Array(rows * cols);
  for (let i = wanted.length - 1; i >= 0; i -= 1) {
    for (let j = transcript.length - 1; j >= 0; j -= 1) {
      dp[i * cols + j] = wanted[i] && wanted[i] === transcript[j]!.normalized
        ? 1 + dp[(i + 1) * cols + j + 1]!
        : Math.max(dp[(i + 1) * cols + j]!, dp[i * cols + j + 1]!);
    }
  }
  const matched = new Map<number, (typeof transcript)[number]>();
  let i = 0;
  let j = 0;
  while (i < wanted.length && j < transcript.length) {
    if (wanted[i] && wanted[i] === transcript[j]!.normalized && dp[i * cols + j] === 1 + dp[(i + 1) * cols + j + 1]!) {
      matched.set(i, transcript[j]!); i += 1; j += 1;
    } else if (dp[(i + 1) * cols + j]! >= dp[i * cols + j + 1]!) i += 1;
    else j += 1;
  }
  const matchedRatio = matched.size / tokens.length;
  if (matchedRatio < MIN_WORD_ALIGNMENT_MATCH_RATIO) {
    return { words: null, matchedRatio, reason: `matched ${(matchedRatio * 100).toFixed(1)}% of narration tokens; minimum is 70%` };
  }

  const words: TimedNarrationWord[] = tokens.map((text) => ({ text, startSec: 0, endSec: 0 }));
  for (const [index, word] of matched) words[index] = { text: tokens[index]!, startSec: word.start, endSec: word.end };
  const anchors = [{ index: -1, end: 0 }, ...[...matched].map(([index, word]) => ({ index, end: word.end })), { index: tokens.length, end: wavDurationSec }];
  for (let anchor = 0; anchor < anchors.length - 1; anchor += 1) {
    const left = anchors[anchor]!;
    const right = anchors[anchor + 1]!;
    const gapStart = left.end;
    const gapEnd = right.index === tokens.length ? wavDurationSec : matched.get(right.index)!.start;
    const count = right.index - left.index - 1;
    if (gapEnd < gapStart) return { words: null, matchedRatio, reason: 'matched spans overlap' };
    for (let offset = 1; offset <= count; offset += 1) {
      const index = left.index + offset;
      words[index] = {
        text: tokens[index]!,
        startSec: gapStart + (gapEnd - gapStart) * (offset - 1) / count,
        endSec: gapStart + (gapEnd - gapStart) * offset / count,
      };
    }
  }
  previousEnd = 0;
  for (const word of words) {
    if (word.startSec < previousEnd || word.endSec < word.startSec || word.endSec > wavDurationSec) {
      return { words: null, matchedRatio, reason: 'interpolated spans are invalid' };
    }
    previousEnd = word.endSec;
  }
  return { words, matchedRatio, reason: null };
}
