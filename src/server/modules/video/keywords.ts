export type TimedWord = { text: string; startSec: number; endSec: number };
export type Keyword = TimedWord;

export const NUMBER_UNIT_TOKENS = new Set(['tỷ', 'triệu', 'nghìn', 'ngàn', 'trăm', '%', 'đô', 'la', 'usd', 'năm']);
export const MAX_KEYWORDS_PER_SCENE = 2;
export const MIN_KEYWORD_START_SPACING_SEC = 2.5;
export const MIN_KEYWORD_HOLD_SEC = 1.2;
export const KEYWORD_FADE_SEC = 0.3;

const clean = (text: string) => text.replace(/[\p{P}]+$/gu, (suffix) => suffix.replace(/[^%]/gu, ''));
const isCapitalized = (text: string) => /^\p{Lu}/u.test(text);
const isSentenceStart = (words: ReadonlyArray<TimedWord>, index: number) =>
  index === 0 || /[.!?]["'”’)]*$/u.test(words[index - 1]?.text ?? '');

type Candidate = { text: string; startSec: number; phraseEndSec: number; priority: number };

/** Select a few narration-derived phrases; endSec includes the full fade. */
export function selectKeywords(words: ReadonlyArray<TimedWord>): Keyword[] {
  if (words.length === 0) return [];
  // The final aligned word ends no later than the WAV. It is a conservative audio-end bound.
  const audioEndSec = words[words.length - 1]!.endSec;
  const candidates: Candidate[] = [];
  for (let index = 0; index < words.length; index++) {
    const first = words[index]!;
    const firstText = clean(first.text);
    if (/\d/u.test(firstText)) {
      let last = index;
      while (last + 1 < words.length && NUMBER_UNIT_TOKENS.has(clean(words[last + 1]!.text).toLocaleLowerCase('vi'))) last++;
      candidates.push({
        text: words.slice(index, last + 1).map((word) => clean(word.text)).join(' ').replace(/ %/gu, '%'),
        startSec: first.startSec,
        phraseEndSec: words[last]!.endSec,
        priority: 0,
      });
      index = last;
      continue;
    }
    if (isSentenceStart(words, index) || !isCapitalized(firstText)) continue;
    let last = index;
    while (last + 1 < words.length && isCapitalized(clean(words[last + 1]!.text))) last++;
    if (last > index) {
      candidates.push({
        text: words.slice(index, last + 1).map((word) => clean(word.text)).join(' '),
        startSec: first.startSec,
        phraseEndSec: words[last]!.endSec,
        priority: 1,
      });
      index = last;
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.startSec - b.startSec);
  const selected: Keyword[] = [];
  for (const candidate of candidates) {
    const endSec = Math.min(audioEndSec, Math.round((candidate.startSec + Math.max(candidate.phraseEndSec - candidate.startSec, MIN_KEYWORD_HOLD_SEC) + KEYWORD_FADE_SEC) * 1000) / 1000);
    if (endSec - candidate.startSec < KEYWORD_FADE_SEC) continue;
    if (selected.some((prior) => Math.abs(prior.startSec - candidate.startSec) < MIN_KEYWORD_START_SPACING_SEC ||
      (candidate.startSec < prior.endSec && prior.startSec < endSec))) continue;
    selected.push({ text: candidate.text, startSec: candidate.startSec, endSec });
    if (selected.length === MAX_KEYWORDS_PER_SCENE) break;
  }
  return selected.sort((a, b) => a.startSec - b.startSec);
}
