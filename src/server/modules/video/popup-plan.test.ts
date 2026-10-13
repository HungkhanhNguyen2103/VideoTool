import { describe, expect, it } from 'vitest';
import type { TimedWord } from './keywords';
import { applyPopupSafetyNet } from './popup-safety-net';
import { extractPopupNumbers, parseVietnameseNumberPhrase } from './popup-number-words';
import { validatePopupCandidate } from './popup-validation';
import { resolveFilmLookByTimedWords } from './keywords';
import { windowPopupTiming } from './popup-window';
import { assemblePopupPlans } from './popup-plan';
import type { PopupPlan } from '../../../contracts/popup-analysis';

const words: TimedWord[] = [
  { text: 'Ba', startSec: 0, endSec: 0.2 },
  { text: 'nghìn', startSec: 0.2, endSec: 0.4 },
  { text: 'người', startSec: 0.4, endSec: 0.6 },
  { text: 'đã', startSec: 1, endSec: 1.2 },
  { text: 'đến.', startSec: 1.2, endSec: 1.4 },
];

describe('Vietnamese popup number words', () => {
  it('parses ba nghìn người as 3000', () => {
    expect(parseVietnameseNumberPhrase('ba nghìn người')).toBe(3000);
  });

  it('keeps whole digit runs and traces spoken/formatted quantities', () => {
    expect(extractPopupNumbers('3000 người')).toContain(3000);
    expect(extractPopupNumbers('3.000')).toContain(3000);
    expect(parseVietnameseNumberPhrase('2,5 triệu')).toBe(2_500_000);
    expect(parseVietnameseNumberPhrase('hai triệu rưỡi')).toBe(2_500_000);
    expect(extractPopupNumbers('12/1285')).toEqual(expect.arrayContaining([12, 1285]));
    expect(extractPopupNumbers('năm 1285')).toContain(1285);
  });
});

describe('AI popup validation', () => {
  it('accepts display digits traced to Vietnamese number words in the anchor', () => {
    expect(validatePopupCandidate(
      'Ba nghìn người đã đến.',
      words,
      { kind: 'number', anchor: 'Ba nghìn người', display: '3.000 quân', importance: 5, reason: 'Cần biết quy mô lực lượng.' },
    )).toMatchObject({ accepted: true, startSec: 0, endSec: 0.6 });
  });

  it('accepts formatted digits against an unformatted narration quantity', () => {
    expect(validatePopupCandidate(
      '3000 người đã đến.',
      [{ text: '3000', startSec: 0, endSec: 0.2 }, { text: 'người', startSec: 0.2, endSec: 0.4 }, { text: 'đã', startSec: 1, endSec: 1.2 }, { text: 'đến.', startSec: 1.2, endSec: 1.4 }],
      { kind: 'number', anchor: '3000 người', display: '3.000 quân', importance: 5, reason: 'Quy mô.' },
    )).toMatchObject({ accepted: true });
  });

  it('traces formatted dates and years, but rejects fabricated quantities', () => {
    const timedWords: TimedWord[] = [
      { text: 'tháng', startSec: 0, endSec: 0.2 }, { text: '12', startSec: 0.2, endSec: 0.4 },
      { text: 'năm', startSec: 0.4, endSec: 0.6 }, { text: '1285', startSec: 0.6, endSec: 0.8 },
    ];
    expect(validatePopupCandidate('tháng 12 năm 1285.', timedWords, { kind: 'date', anchor: 'tháng 12 năm 1285', display: '12/1285', importance: 4, reason: 'Mốc.' })).toMatchObject({ accepted: true });
    expect(validatePopupCandidate('Năm 1285.', [{ text: 'Năm', startSec: 0, endSec: 0.2 }, { text: '1285', startSec: 0.2, endSec: 0.4 }], { kind: 'year', anchor: 'Năm 1285', display: '1285', importance: 4, reason: 'Mốc.' })).toMatchObject({ accepted: true });
    expect(validatePopupCandidate('3000 người.', [{ text: '3000', startSec: 0, endSec: 0.2 }, { text: 'người.', startSec: 0.2, endSec: 0.4 }], { kind: 'number', anchor: '3000 người', display: '4.000 quân', importance: 5, reason: 'Quy mô.' })).toMatchObject({ accepted: false, reason: 'digits not traceable' });
  });

  it('rejects digits that are not traceable to narration or evidence', () => {
    expect(validatePopupCandidate(
      'Ba nghìn người đã đến.',
      words,
      { kind: 'number', anchor: 'Ba nghìn người', display: '12.000 quân', importance: 5, reason: 'Quy mô.' },
    )).toMatchObject({ accepted: false, reason: 'digits not traceable' });
  });

  it('rejects a non-contiguous anchor and an invalid year display', () => {
    expect(validatePopupCandidate(
      'Ba nghìn người đã đến.',
      words,
      { kind: 'event', anchor: 'Ba người', display: 'Ba người', importance: 3, reason: 'Sự kiện.' },
    )).toMatchObject({ accepted: false, reason: 'anchor is not a contiguous timed-word run' });
    expect(validatePopupCandidate(
      'Năm 1785 đã đến.',
      [{ text: 'Năm', startSec: 0, endSec: 0.2 }, { text: '1785', startSec: 0.2, endSec: 0.4 }],
      { kind: 'year', anchor: 'Năm 1785', display: '1785 năm', importance: 4, reason: 'Mốc thời gian.' },
    )).toMatchObject({ accepted: false, reason: 'invalid year display' });
  });

  it('accepts a verified evidence quote and rejects an unverified quote', () => {
    const candidate = { kind: 'date' as const, anchor: 'đã đến', display: '12/1285', importance: 4, reason: 'Ngày xuất binh.' , evidence: 'Ngày xuất binh là 12/1285.' };
    const timedWords: TimedWord[] = [{ text: 'đã', startSec: 0, endSec: 0.2 }, { text: 'đến', startSec: 0.2, endSec: 0.4 }];
    expect(validatePopupCandidate('đã đến.', timedWords, candidate, { referencesText: 'Ngày xuất binh là 12/1285.' })).toMatchObject({ accepted: true });
    expect(validatePopupCandidate('đã đến.', timedWords, candidate, { referencesText: 'Một ngày khác.' })).toMatchObject({ accepted: false, reason: 'evidence quote not verified' });
  });
});

describe('popup timing windows', () => {
  it('keeps the old center and lower-third hold/fade windows within audio', () => {
    const words: TimedWord[] = [{ text: 'mốc', startSec: 0, endSec: 5 }];
    expect(windowPopupTiming({ kind: 'number', startSec: 0, endSec: 0.2 }, words)).toEqual({ accepted: true, startSec: 0, endSec: 1.5 });
    expect(windowPopupTiming({ kind: 'person', startSec: 0, endSec: 0.2 }, words)).toEqual({ accepted: true, startSec: 0, endSec: 3.3 });
  });

  it('starts a lower-third up to 0.5 seconds earlier when that preserves at least one second', () => {
    for (const kind of ['person', 'place', 'event'] as const) {
      expect(windowPopupTiming({ kind, startSec: 2.04, endSec: 2.2 }, [{ text: 'mốc', startSec: 0, endSec: 2.98 }])).toEqual({ accepted: true, startSec: 1.54, endSec: 2.98 });
    }
  });

  it('keeps center popup timing anchored and does not allow a sub-second lower-third', () => {
    for (const kind of ['number', 'year', 'date'] as const) {
      expect(windowPopupTiming({ kind, startSec: 0.4, endSec: 0.6 }, [{ text: 'mốc', startSec: 0, endSec: 0.8 }])).toEqual({ accepted: true, startSec: 0.4, endSec: 0.8 });
    }
    expect(windowPopupTiming({ kind: 'person', startSec: 1, endSec: 1.2 }, [{ text: 'mốc', startSec: 0, endSec: 1.48 }])).toMatchObject({ accepted: false, reason: 'không đủ thời gian hiển thị popup' });
  });
});

describe('popup safety net', () => {
  it('keeps the higher-importance popup and records a close-start drop', () => {
    const result = applyPopupSafetyNet([
      { sceneId: 'scene-1', sceneStartSec: 0, popup: { kind: 'number', anchor: 'một', display: '1', importance: 2, reason: 'small', startSec: 1, endSec: 2 } },
      { sceneId: 'scene-2', sceneStartSec: 2, popup: { kind: 'number', anchor: 'hai', display: '2', importance: 5, reason: 'large', startSec: 0.5, endSec: 1.5 } },
    ]);
    expect(result.kept.map((entry) => entry.popup.display)).toEqual(['2']);
    expect(result.dropped).toMatchObject([{ popup: { display: '1', dropReason: 'gần popup khác' } }]);
  });

  it('caps each scene at two popups and records every safety-net drop', () => {
    const result = applyPopupSafetyNet([
      ...[1, 2, 3].map((value) => ({ sceneId: 'scene-1', sceneStartSec: 0, popup: { kind: 'number' as const, anchor: String(value), display: String(value), importance: value, reason: 'r', startSec: value * 4, endSec: value * 4 + 1 } })),
    ]);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.popup.dropReason).toBe('quá nhiều popup trong scene');
  });
  it('records repeated person/place/event mentions as visible cross-scene drops', () => {
    const result = applyPopupSafetyNet([
      { sceneId: 'scene-1', sceneStartSec: 0, popup: { kind: 'person', anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 5, reason: 'first', startSec: 1, endSec: 2 } },
      { sceneId: 'scene-2', sceneStartSec: 10, popup: { kind: 'person', anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 5, reason: 'repeat', startSec: 1, endSec: 2 } },
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toMatchObject([{ popup: { status: 'dropped', dropReason: 'đã hiện ở cảnh trước' } }]);
  });

  it('keeps a pinned repeated name while still applying overlap safety', () => {
    const result = applyPopupSafetyNet([
      { sceneId: 'scene-1', sceneStartSec: 0, popup: { kind: 'person' as const, anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 5, reason: 'first', startSec: 1, endSec: 2 } },
      { sceneId: 'scene-2', sceneStartSec: 10, popup: { kind: 'person' as const, anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 5, reason: 'pinned repeat', startSec: 1, endSec: 2, pinned: true } },
    ]);
    expect(result.kept).toHaveLength(2);
    expect(result.kept[1]?.popup.pinned).toBe(true);
    expect(result.dropped).toHaveLength(0);
  });
});

describe('rule-free project selection', () => {
  it('does not emit a digit or capitalized-name popup without a validated plan', async () => {
    const { selectProjectSceneKeywords } = await import('./keywords');
    const scene = {
      id: 'scene-1', narration: 'Năm 1785, Nguyễn Huệ dẫn 3000 quân.', visualPrompt: '', durationSec: 6,
      assetType: 'image', assetFileId: null, audioFileId: 'voice-1', voiceoverDurationSec: 5, voiceoverInput: null,
      wordTimings: { audioFileId: 'voice-1', words: [
        { text: 'Năm', startSec: 0, endSec: 0.2 }, { text: '1785,', startSec: 0.2, endSec: 0.4 }, { text: 'Nguyễn', startSec: 1, endSec: 1.2 }, { text: 'Huệ', startSec: 1.2, endSec: 1.4 }, { text: '3000', startSec: 2, endSec: 2.2 }, { text: 'quân.', startSec: 2.2, endSec: 2.4 },
      ] },
      nameCandidates: null, popupPlan: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null,
      videoKeyframeFileId: null, videoTailFileId: null, videoDurationSec: null, depthMap: null,
    } as never;
    expect(selectProjectSceneKeywords([scene])[0]?.keywords).toEqual([]);
  });

  it('keeps automatic film look year detection independent from displayed popups', () => {
    expect(resolveFilmLookByTimedWords([[{ text: 'Năm', startSec: 0, endSec: 0.2 }, { text: '1785', startSec: 0.2, endSec: 0.4 }]], 'auto')).toEqual([true]);
  });
});

describe('project-wide popup-plan assembly', () => {
  const assemblyScenes = [
    { id: 'scene-1', scene: 1, sceneStartSec: 0, narration: 'Nguyễn Huệ dẫn 3000 người.', audioFileId: 'voice-1', words: [{ text: 'Nguyễn', startSec: 0, endSec: 0.2 }, { text: 'Huệ', startSec: 0.2, endSec: 0.4 }, { text: 'dẫn', startSec: 0.4, endSec: 0.6 }, { text: '3000', startSec: 0.6, endSec: 0.8 }, { text: 'người.', startSec: 0.8, endSec: 1 }, { text: 'xong', startSec: 4, endSec: 5 }] },
    { id: 'scene-2', scene: 2, sceneStartSec: 5, narration: 'Nguyễn Huệ đến Sông Tiền.', audioFileId: 'voice-2', words: [{ text: 'Nguyễn', startSec: 0, endSec: 0.2 }, { text: 'Huệ', startSec: 0.2, endSec: 0.4 }, { text: 'đến', startSec: 0.4, endSec: 0.6 }, { text: 'Sông', startSec: 0.6, endSec: 0.8 }, { text: 'Tiền.', startSec: 0.8, endSec: 1 }, { text: 'xong', startSec: 4, endSec: 5 }] },
  ] as const;

  const base = {
    scenes: assemblyScenes,
    previousPlans: new Map(),
    brief: '', referencesText: '', density: 'low' as const, backend: 'api' as const, provider: 'deepseek' as const, model: 'deepseek-chat', now: new Date('2026-10-13T00:00:00.000Z'),
  };

  it('stores a not-needed verdict for every eligible scene without popups', () => {
    const result = assemblePopupPlans({ ...base, aiOutput: { scenes: [
      { scene: 1, needed: false, reason: 'Không có mốc mới quan trọng.', popups: [] },
      { scene: 2, needed: false, reason: 'Không cần chữ để theo dõi.', popups: [] },
    ] } });
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map(({ plan }) => ({ needed: plan.needed, reason: plan.reason, popups: plan.popups }))).toEqual([
      { needed: false, reason: 'Không có mốc mới quan trọng.', popups: [] },
      { needed: false, reason: 'Không cần chữ để theo dõi.', popups: [] },
    ]);
  });

  it('runs validation and the safety net once over merged scenes, recording dedupe/conflict drops', () => {
    const result = assemblePopupPlans({ ...base, aiOutput: { scenes: [
      { scene: 1, needed: true, reason: 'Có dữ kiện chính.', popups: [
        { scene: 1, kind: 'person', anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 3, reason: 'Nhân vật chính.' },
        { scene: 1, kind: 'number', anchor: '3000 người', display: '3.000 quân', importance: 5, reason: 'Quy mô trận đánh.' },
        { scene: 1, kind: 'number', anchor: '3000 người', display: '4.000 quân', importance: 5, reason: 'Sai số.' },
      ] },
      { scene: 2, needed: true, reason: 'Nhắc lại nhân vật và địa danh.', popups: [
        { scene: 2, kind: 'person', anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 5, reason: 'Nhắc lại.' },
        { scene: 2, kind: 'place', anchor: 'Sông Tiền', display: 'Sông Tiền', importance: 4, reason: 'Địa danh chính.' },
      ] },
    ] } });
    expect(result.summary.rejectedByValidation).toBe(1);
    expect(result.summary.droppedPopups).toBe(2);
    expect(result.plans[0]!.plan.popups.map((popup) => popup.display)).toEqual(['3.000 quân']);
    expect(result.plans[1]!.plan.dropped).toMatchObject([{ display: 'Nguyễn Huệ', dropReason: 'đã hiện ở cảnh trước' }]);
  });

  it('carries pin and suppress flags by scene and normalized anchor', () => {
    const previous = {
      narrationHash: 'old', audioFileId: 'voice-1', provider: 'deepseek' as const, model: 'deepseek-chat', backend: 'api' as const, density: 'low' as const, generatedAt: '2026-10-12T00:00:00.000Z', needed: true, reason: 'old',
      popups: [{ kind: 'person' as const, anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 2, reason: 'old', startSec: 0, endSec: 3.3, status: 'kept' as const, dropReason: null, pinned: true, suppressed: false }], dropped: [],
    };
    const suppressed = { ...previous, audioFileId: 'voice-2', popups: [{ ...previous.popups[0]!, kind: 'place' as const, anchor: 'Sông Tiền', display: 'Sông Tiền', pinned: false, suppressed: true }] };
    const result = assemblePopupPlans({ ...base, previousPlans: new Map<string, PopupPlan>([['scene-1', previous], ['scene-2', suppressed]]), aiOutput: { scenes: [
      { scene: 1, needed: true, reason: 'Nhân vật.', popups: [{ scene: 1, kind: 'person', anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 1, reason: 'Nhân vật.' }] },
      { scene: 2, needed: true, reason: 'Địa danh.', popups: [{ scene: 2, kind: 'place', anchor: 'Sông Tiền', display: 'Sông Tiền', importance: 1, reason: 'Địa danh.' }] },
    ] } });
    expect(result.plans[0]!.plan.popups[0]).toMatchObject({ pinned: true, suppressed: false });
    expect(result.plans[1]!.plan.dropped[0]).toMatchObject({ suppressed: true, dropReason: 'đã tắt' });
  });

  it('keeps an insufficient-window rejection visible in the scene plan', () => {
    const scene = { ...assemblyScenes[0], words: [{ text: 'Nguyễn', startSec: 0, endSec: 0.2 }, { text: 'Huệ', startSec: 0.2, endSec: 0.4 }] } as const;
    const result = assemblePopupPlans({ ...base, scenes: [scene], aiOutput: { scenes: [
      { scene: 1, needed: true, reason: 'Nhân vật.', popups: [{ scene: 1, kind: 'person', anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 5, reason: 'Nhân vật.' }] },
    ] } });
    expect(result.summary.rejectedByValidation).toBe(1);
    expect(result.plans[0]!.plan.dropped).toMatchObject([{ display: 'Nguyễn Huệ', dropReason: 'không đủ thời gian hiển thị popup' }]);
  });
});
