import type { TimedWord } from './keywords';

export type NameCandidateKind = 'person' | 'place' | 'event' | 'group';
export type NameCandidateInput = { phrase: string; kind: NameCandidateKind; role?: string };

export type ValidatedNameCandidate = NameCandidateInput & {
  startWordIndex: number;
  endWordIndex: number;
  startSec: number;
  endSec: number;
};

export type NameCandidateValidation =
  | ({ accepted: true } & ValidatedNameCandidate)
  | ({ accepted: false; reason: string } & NameCandidateInput);

export function normalizeNameMention(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeTimedWord(value: string): string {
  return normalizeNameMention(value).replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
}

export function validateNameCandidate(
  narration: string,
  words: ReadonlyArray<TimedWord>,
  candidate: NameCandidateInput,
): NameCandidateValidation {
  const phraseWords = candidate.phrase.split(/\s+/u).map(normalizeTimedWord).filter(Boolean);
  if (phraseWords.length === 0) return { ...candidate, accepted: false, reason: 'empty phrase' };
  if (!normalizeNameMention(narration).includes(normalizeNameMention(candidate.phrase))) {
    return { ...candidate, accepted: false, reason: 'not found verbatim in narration' };
  }
  for (let start = 0; start + phraseWords.length <= words.length; start += 1) {
    const matches = phraseWords.every((word, offset) => normalizeTimedWord(words[start + offset]!.text) === word);
    if (!matches) continue;
    const end = start + phraseWords.length - 1;
    return {
      ...candidate,
      accepted: true,
      startWordIndex: start,
      endWordIndex: end,
      startSec: words[start]!.startSec,
      endSec: words[end]!.endSec,
    };
  }
  return { ...candidate, accepted: false, reason: 'not a contiguous timed-word run' };
}

export function validateNameCandidates(
  narration: string,
  words: ReadonlyArray<TimedWord>,
  candidates: ReadonlyArray<NameCandidateInput>,
): NameCandidateValidation[] {
  return candidates.map((candidate) => validateNameCandidate(narration, words, candidate));
}
