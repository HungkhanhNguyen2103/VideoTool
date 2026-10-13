import { describe, expect, it } from 'vitest';
import type { Scene } from '../../../contracts/project';
import { hashNarration } from '../../../contracts/name-keywords';
import { annotateNameKeywords, annotateYearKeywords, nameKeywordDedupeKey, parseNumberPhrase, resolveFilmLookByTimedWords, selectProjectSceneKeywords, type Keyword } from './keywords';

const words = (...items: Array<[string, number, number]>) => items.map(([text, startSec, endSec]) => ({ text, startSec, endSec }));

function sceneWithPlan(overrides: Partial<Scene> = {}): Scene {
  const narration = overrides.narration ?? 'Năm 1785, Sông Tiền có 3.000 quân.';
  return {
    id: 'scene-1', narration, visualPrompt: '', durationSec: 8, active: true, assetType: 'image', assetFileId: null,
    audioFileId: 'voice-1', voiceoverDurationSec: 7, voiceoverInput: null,
    wordTimings: { audioFileId: 'voice-1', words: words(['Năm', 0, .2], ['1785,', .2, .4], ['Sông', 1, 1.2], ['Tiền', 1.2, 1.4], ['có', 2, 2.2], ['3.000', 2.2, 2.4], ['quân.', 2.4, 2.6]) },
    nameCandidates: null, popupPlan: {
      narrationHash: hashNarration(narration), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat', backend: 'api', density: 'low', generatedAt: '2026-10-13T00:00:00.000Z', needed: true, reason: 'Cần hiển thị mốc chính.',
      popups: [{ kind: 'place', anchor: 'Sông Tiền', display: 'Sông Tiền', importance: 4, reason: 'Địa danh chính.', startSec: 1, endSec: 4.3, status: 'kept', dropReason: null, pinned: false, suppressed: false }, { kind: 'number', anchor: '3.000 quân.', display: '3.000 quân', importance: 5, reason: 'Quy mô quan trọng.', startSec: 2.2, endSec: 3.5, status: 'kept', dropReason: null, pinned: false, suppressed: false }], dropped: [],
    },
    sfxPrompt: '', motionPrompt: '', sfxFileId: null, videoKeyframeFileId: null, videoTailFileId: null, videoDurationSec: null, depthMap: null,
    ...overrides,
  };
}

describe('project popup-plan selection', () => {
  it('converts only fresh kept plan entries into existing Keyword shapes', () => {
    const selection = selectProjectSceneKeywords([sceneWithPlan()])[0]!;
    expect(selection.keywords).toMatchObject([
      { text: 'Sông Tiền', kind: 'name', nameRole: 'place', startSec: 1 },
      { text: '3.000 quân', kind: 'number', value: 3000, startSec: 2.2 },
    ]);
    expect(selection.popup).toEqual({ text: 'Sông Tiền', type: 'place', source: 'ai' });
  });

  it('renders no popup when a plan is missing or stale, even with digits and names in narration', () => {
    const scene = sceneWithPlan();
    expect(selectProjectSceneKeywords([{ ...scene, popupPlan: null }])[0]!.keywords).toEqual([]);
    expect(selectProjectSceneKeywords([{ ...scene, popupPlan: { ...scene.popupPlan!, narrationHash: hashNarration('old') } }])[0]!.keywords).toEqual([]);
  });

  it('returns no popup or keywords for an inactive scene with a fresh plan', () => {
    const scene = sceneWithPlan({ active: false });
    expect(selectProjectSceneKeywords([scene])[0]).toMatchObject({ sceneId: scene.id, keywords: [], popup: null });
  });

  it('does not read legacy nameCandidates as a fallback', () => {
    const scene = sceneWithPlan({ popupPlan: null, nameCandidates: { narrationHash: hashNarration('Năm 1785, Sông Tiền có 3.000 quân.'), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat', generatedAt: '2026-10-13T00:00:00.000Z', candidates: [{ phrase: 'Sông Tiền', kind: 'place' }] } });
    expect(selectProjectSceneKeywords([scene])[0]).toMatchObject({ keywords: [], popup: null });
  });

});

describe('renderer annotations that remain after rule removal', () => {
  it('parses numeric display metadata without selecting a popup', () => {
    expect(parseNumberPhrase('3.000 quân')).toMatchObject({ value: 3000, grouping: true, suffix: 'quân' });
    expect(selectProjectSceneKeywords([sceneWithPlan({ popupPlan: { ...sceneWithPlan().popupPlan!, popups: [] } })])[0]!.keywords).toEqual([]);
  });

  it('chains years only for already-approved plan keywords', () => {
    const keyword: Keyword = { text: '1975', startSec: 0, endSec: 1, kind: 'year', year: 1975 };
    expect(annotateYearKeywords([[keyword]])[0]![0]).toMatchObject({ fromYear: 1965, timeline: { min: 1964, max: 1976 } });
  });

  it('keeps film-look year detection independent of displayed plan entries', () => {
    expect(resolveFilmLookByTimedWords([[{ text: 'Năm', startSec: 0, endSec: .2 }, { text: '1785', startSec: .2, endSec: .4 }], [{ text: '2012', startSec: 0, endSec: .2 }]], 'auto')).toEqual([true, false]);
  });

  it('retains first-mention dedupe helpers for explicit plan annotations', () => {
    expect(nameKeywordDedupeKey('Sông Tiền')).toBe(nameKeywordDedupeKey('Tiền'));
    const keyword = (text: string, startSec: number): Keyword => ({ text, startSec, endSec: startSec + 1, kind: 'name' });
    expect(annotateNameKeywords([[keyword('Sông Tiền', 1)], [keyword('Tiền', 2)], [keyword('Nguyễn Huệ', 3)]]).map((scene) => scene.map((item) => item.text))).toEqual([['Sông Tiền'], [], ['Nguyễn Huệ']]);
  });
});
