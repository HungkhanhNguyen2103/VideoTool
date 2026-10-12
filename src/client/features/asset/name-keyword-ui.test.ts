import { describe, expect, it } from 'vitest';
import type { Scene } from '../../../contracts/project';
import { hashNarration } from '../../../contracts/name-keywords';
import { nameKeywordPopupLine, nameKeywordStatusText } from './name-keyword-ui';

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1', narration: 'Narration', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: null,
    audioFileId: 'voice-1', voiceoverDurationSec: null, voiceoverInput: null, wordTimings: { audioFileId: 'voice-1', words: [{ text: 'Narration', startSec: 0, endSec: 4 }] },
    nameCandidates: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null,
    videoKeyframeFileId: null, videoTailFileId: null, videoDurationSec: null, depthMap: null,
    ...overrides,
  };
}

describe('name keyword Studio presentation', () => {
  it('derives the unanalysed, fresh, and stale project status without guessing', () => {
    expect(nameKeywordStatusText([scene()])).toContain('Có kết quả mới: 0 · Đã cũ: 0 · Chưa phân tích: 1');
    const analyzed = scene({ nameCandidates: {
      narrationHash: hashNarration('Narration'), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat',
      generatedAt: '2026-10-07T06:40:00.000Z', candidates: [{ phrase: 'Sông Tiền', kind: 'place' }],
    } });
    expect(nameKeywordStatusText([analyzed])).toContain('Có kết quả mới: 1 · Đã cũ: 0 · Chưa phân tích: 0');
    expect(nameKeywordStatusText([analyzed])).toContain('AI (DeepSeek) · 1/1 scene có tên · cập nhật');
    const staleWithoutAudio = scene({ ...analyzed, audioFileId: null, wordTimings: null });
    expect(nameKeywordStatusText([staleWithoutAudio])).toContain('Có kết quả mới: 0 · Đã cũ: 1 · Chưa phân tích: 0');
    expect(nameKeywordPopupLine(null)).toBe('Popup tên: —');

    const realignedWithOldRecord = scene({
      ...analyzed,
      narration: 'New narration',
      audioFileId: 'voice-2',
      wordTimings: { audioFileId: 'voice-2', words: [{ text: 'New', startSec: 0, endSec: .2 }] },
    });
    expect(nameKeywordStatusText([realignedWithOldRecord])).toContain('Có kết quả mới: 0 · Đã cũ: 1 · Chưa phân tích: 0');
    expect(nameKeywordStatusText([analyzed, staleWithoutAudio, scene()])).toContain('Có kết quả mới: 1 · Đã cũ: 1 · Chưa phân tích: 1');
  });

  it('formats the server-selected popup, source, and empty state as read-only text', () => {
    expect(nameKeywordPopupLine({ text: 'Sông Tiền', type: 'place', source: 'ai' })).toBe('Popup tên: Sông Tiền (địa danh · AI)');
    expect(nameKeywordPopupLine({ text: 'Rạch Gầm', type: 'other', source: 'rules' })).toBe('Popup tên: Rạch Gầm (tên riêng · quy tắc)');
    expect(nameKeywordPopupLine(null)).toBe('Popup tên: —');
  });
});
