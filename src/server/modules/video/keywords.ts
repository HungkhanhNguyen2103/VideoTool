import type { KeywordKind, RemotionKeyword } from '../../../contracts/video';
import type { FilmLookStyle, Scene } from '../../../contracts/project';
import type { PopupPlanPopup } from '../../../contracts/popup-analysis';
import { hashNarration } from '../../../contracts/name-keywords';
import { isSceneActive } from '../../../contracts/scene-active';

export type TimedWord = { text: string; startSec: number; endSec: number };
export type Keyword = RemotionKeyword & { kind: KeywordKind };

/** Lone 4-digit tokens in this range are treated as calendar years. */
export const YEAR_RANGE = { min: 1000, max: 2100 } as const;
/** The first year in a video rolls up from this many years earlier. */
export const FIRST_YEAR_ROLL_SPAN = 10;
/** Timeline padding as a fraction of its span (at least one year each side). */
export const TIMELINE_PAD_RATIO = 0.05;
export const FILM_LOOK_BEFORE_YEAR = 1990;

export type SceneNamePopupPreview = { text: string; type: 'person' | 'place' | 'other'; source: 'ai' | 'rules' } | null;
export type ProjectSceneKeywordSelection = { sceneId: string; keywords: Keyword[]; popup: SceneNamePopupPreview };

function clean(text: string): string {
  return text.replace(/[\p{P}]+$/gu, (suffix) => suffix.replace(/[^%]/gu, ''));
}

function isYearToken(value: string): boolean {
  return /^\d{4}$/u.test(value) && Number(value) >= YEAR_RANGE.min && Number(value) <= YEAR_RANGE.max;
}

/**
 * Parse a Vietnamese-formatted leading number ("." = thousands, "," = decimal).
 * Returns null when the phrase does not start with a cleanly formatted number.
 */
export function parseNumberPhrase(text: string): { value: number; decimals: number; grouping: boolean; prefix: string; suffix: string } | null {
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?![\d.,])/u.exec(text);
  if (!match) return null;
  const integer = match[1]!;
  const fraction = match[2] ?? '';
  const value = Number(`${integer.replace(/\./gu, '')}${fraction ? `.${fraction}` : ''}`);
  if (!Number.isFinite(value)) return null;
  return { value, decimals: fraction.length, grouping: integer.includes('.'), prefix: '', suffix: text.slice(match[0].length).trimStart() };
}

function enrichKeyword(keyword: Keyword): Keyword {
  if (keyword.kind === 'number') {
    const parsed = parseNumberPhrase(keyword.text);
    return parsed ? { ...keyword, ...parsed } : keyword;
  }
  if (keyword.kind === 'year') return { ...keyword, year: Number(keyword.text) };
  if (keyword.kind === 'date') {
    const year = Number(keyword.text.split('/').at(-1));
    return Number.isInteger(year) ? { ...keyword, year } : keyword;
  }
  return keyword;
}

function popupPlanFresh(scene: Scene): scene is Scene & { popupPlan: NonNullable<Scene['popupPlan']> } {
  return Boolean(scene.popupPlan && scene.audioFileId && scene.wordTimings?.audioFileId === scene.audioFileId
    && scene.popupPlan.audioFileId === scene.audioFileId && scene.popupPlan.narrationHash === hashNarration(scene.narration));
}

function popupToKeyword(popup: PopupPlanPopup): Keyword {
  const kind: KeywordKind = popup.kind === 'person' || popup.kind === 'place' || popup.kind === 'event' ? 'name' : popup.kind;
  const keyword: Keyword = { text: popup.display, startSec: popup.startSec, endSec: popup.endSec, kind };
  if (kind === 'name') {
    if (popup.kind === 'person') keyword.nameRole = 'person';
    if (popup.kind === 'place') keyword.nameRole = 'place';
    if (popup.kind === 'person' && popup.role?.trim()) keyword.subtitle = sentenceCase(popup.role.trim());
  }
  return enrichKeyword(keyword);
}

function sentenceCase(value: string): string {
  const lower = value.toLocaleLowerCase('vi');
  return `${lower.slice(0, 1).toLocaleUpperCase('vi')}${lower.slice(1)}`;
}

/**
 * The renderer consumes only validated, fresh popup-plan entries. No narration
 * token, date, capitalization, prefix, or stale-name fallback is selected here.
 */
export function selectProjectSceneKeywords(scenes: readonly Scene[]): ProjectSceneKeywordSelection[] {
  return scenes.map((scene) => {
    if (!isSceneActive(scene)) return { sceneId: scene.id, keywords: [], popup: null };
    if (!popupPlanFresh(scene)) return { sceneId: scene.id, keywords: [], popup: null };
    const keywords = scene.popupPlan.popups
      .filter((popup) => popup.status === 'kept' && !popup.suppressed)
      .map(popupToKeyword)
      .sort((left, right) => left.startSec - right.startSec);
    const name = keywords.find((keyword) => keyword.kind === 'name');
    return {
      sceneId: scene.id,
      keywords,
      popup: name ? { text: name.text, type: name.nameRole ?? 'other', source: 'ai' } : null,
    };
  });
}

/**
 * Chain year pop-ups across the whole video, in mention order. This remains a
 * renderer annotation and does not decide whether a year popup is needed.
 */
export function annotateYearKeywords(scenes: ReadonlyArray<ReadonlyArray<Keyword>>): Keyword[][] {
  let previous: number | null = null;
  const mentioned: number[] = [];
  const chained = scenes.map((keywords) => [...keywords].sort((a, b) => a.startSec - b.startSec).map((keyword) => {
    if (keyword.year === undefined) return keyword;
    let next: Keyword = keyword;
    if (keyword.kind === 'year') {
      const fromYear = Math.max(YEAR_RANGE.min, previous ?? keyword.year - FIRST_YEAR_ROLL_SPAN);
      next = { ...keyword, fromYear };
      mentioned.push(fromYear);
    }
    mentioned.push(keyword.year);
    previous = keyword.year;
    return next;
  }));
  if (mentioned.length === 0) return chained;
  let min = Math.min(...mentioned);
  let max = Math.max(...mentioned);
  if (max === min) max = min + 1;
  const pad = Math.max(1, Math.round((max - min) * TIMELINE_PAD_RATIO));
  min -= pad;
  max += pad;
  return chained.map((keywords) => keywords.map((keyword) => (keyword.kind === 'year' ? { ...keyword, timeline: { min, max } } : keyword)));
}

/** Detect years only for film-look selection; this never creates a displayed popup. */
export function detectYearsFromTimedWords(words: ReadonlyArray<TimedWord>): Array<Pick<Keyword, 'year' | 'startSec'>> {
  const detected: Array<Pick<Keyword, 'year' | 'startSec'>> = [];
  for (let index = 0; index < words.length; index += 1) {
    const current = clean(words[index]!.text).toLocaleLowerCase('vi');
    const next = clean(words[index + 1]?.text ?? '');
    if (current === 'năm' && isYearToken(next)) detected.push({ year: Number(next), startSec: words[index]!.startSec });
    if (isYearToken(clean(words[index]!.text))) detected.push({ year: Number(clean(words[index]!.text)), startSec: words[index]!.startSec });
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/u.test(clean(words[index]!.text))) detected.push({ year: Number(clean(words[index]!.text).split('/').at(-1)), startSec: words[index]!.startSec });
  }
  return detected;
}

/** Resolve the old-film look from the latest narrated year, independent of popup selection. */
export function resolveFilmLookByScene(
  scenes: ReadonlyArray<ReadonlyArray<Pick<Keyword, 'year' | 'startSec'>>>,
  style: FilmLookStyle = 'auto',
): boolean[] {
  if (style === 'always') return scenes.map(() => true);
  if (style === 'off') return scenes.map(() => false);
  let currentYear: number | null = null;
  return scenes.map((keywords) => {
    for (const keyword of [...keywords].sort((a, b) => a.startSec - b.startSec)) if (keyword.year !== undefined) currentYear = keyword.year;
    return currentYear !== null && currentYear < FILM_LOOK_BEFORE_YEAR;
  });
}

export function resolveFilmLookByTimedWords(scenes: ReadonlyArray<ReadonlyArray<TimedWord>>, style: FilmLookStyle = 'auto'): boolean[] {
  return resolveFilmLookByScene(scenes.map(detectYearsFromTimedWords), style);
}

function normalizeNameMention(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[đĐ]/gu, 'd').toLocaleLowerCase('vi').replace(/\s+/gu, ' ').trim();
}

export function nameKeywordDedupeKey(value: string): string {
  const normalized = normalizeNameMention(value);
  for (const prefix of ['sông', 'núi', 'rạch', 'thành phố', 'tỉnh', 'trận'].map(normalizeNameMention)) {
    if (normalized.startsWith(`${prefix} `)) return normalized.slice(prefix.length + 1);
  }
  return normalized;
}

/** Keep only the first lower-third mention of each name across the project. */
export function annotateNameKeywords(scenes: ReadonlyArray<ReadonlyArray<Keyword>>): Keyword[][] {
  const seen = new Set<string>();
  return scenes.map((keywords) => keywords.filter((keyword) => {
    if (keyword.kind !== 'name') return true;
    const key = nameKeywordDedupeKey(keyword.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}
