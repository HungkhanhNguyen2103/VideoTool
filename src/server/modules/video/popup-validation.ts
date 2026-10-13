import type { PopupKind } from '../../../contracts/popup-analysis';
import type { TimedWord } from './keywords';
import { extractPopupNumbers } from './popup-number-words';

export type PopupCandidateInput = {
  kind: PopupKind;
  anchor: string;
  display: string;
  importance: number;
  reason: string;
  role?: string;
  evidence?: string;
};

export type PopupValidationResult =
  | ({ accepted: true; startSec: number; endSec: number } & PopupCandidateInput)
  | ({ accepted: false; reason: string } & PopupCandidateInput);

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[đĐ]/gu, 'd').toLocaleLowerCase('vi');
}

function normalizeWord(value: string): string {
  return normalize(value).replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function findTimedAnchor(narration: string, words: ReadonlyArray<TimedWord>, anchor: string): { startSec: number; endSec: number } | null {
  const normalizedAnchor = normalize(narration).includes(normalize(anchor));
  if (!normalizedAnchor) return null;
  const phraseWords = anchor.split(/\s+/u).map(normalizeWord).filter(Boolean);
  for (let start = 0; start + phraseWords.length <= words.length; start += 1) {
    if (!phraseWords.every((word, offset) => normalizeWord(words[start + offset]!.text) === word)) continue;
    return { startSec: words[start]!.startSec, endSec: words[start + phraseWords.length - 1]!.endSec };
  }
  return null;
}

function validShape(kind: PopupKind, display: string): boolean {
  if (kind === 'year') return /^(?:1\d{3}|20\d{2}|21\d{2})$/u.test(display.trim());
  if (kind === 'date') return /^(?:\d{1,2}\/\d{4}|\d{1,2}\/\d{1,2}\/\d{4})$/u.test(display.trim());
  return true;
}

export function validatePopupCandidate(
  narration: string,
  words: ReadonlyArray<TimedWord>,
  candidate: PopupCandidateInput,
  source: { brief?: string; referencesText?: string } = {},
): PopupValidationResult {
  if (!candidate.display.trim()) return { ...candidate, accepted: false, reason: 'empty display' };
  if (wordCount(candidate.display) > 6) return { ...candidate, accepted: false, reason: 'display is longer than 6 words' };
  if (!validShape(candidate.kind, candidate.display)) return { ...candidate, accepted: false, reason: `invalid ${candidate.kind} display` };
  if (candidate.evidence && !(source.brief ?? '').includes(candidate.evidence) && !(source.referencesText ?? '').includes(candidate.evidence)) {
    return { ...candidate, accepted: false, reason: 'evidence quote not verified' };
  }
  const timing = findTimedAnchor(narration, words, candidate.anchor);
  if (!timing) return { ...candidate, accepted: false, reason: 'anchor is not a contiguous timed-word run' };
  if (candidate.display.match(/\d/gu)) {
    const sourceNumbers = extractPopupNumbers([candidate.anchor, narration, candidate.evidence ?? ''].join(' '));
    const displayNumbers = extractPopupNumbers(candidate.display);
    if (displayNumbers.some((value) => !sourceNumbers.includes(value))) return { ...candidate, accepted: false, reason: 'digits not traceable' };
  }
  return { ...candidate, accepted: true, ...timing };
}
