import { describe, expect, it } from 'vitest';
import { nameKeywordPopupLine } from './name-keyword-ui';

describe('popup-plan Studio presentation', () => {
  it('formats a plan popup and empty state as read-only text', () => {
    const base = { anchor: 'Sông Tiền', display: 'Sông Tiền', importance: 4, reason: 'Địa danh chính.', startSec: 1, endSec: 4.3, status: 'kept' as const, dropReason: null, pinned: false, suppressed: false };
    expect(nameKeywordPopupLine({ ...base, kind: 'place' })).toBe('Popup tên: Sông Tiền (địa danh · AI)');
    expect(nameKeywordPopupLine({ ...base, kind: 'person', display: 'Nguyễn Huệ' })).toBe('Popup tên: Nguyễn Huệ (người · AI)');
    expect(nameKeywordPopupLine(null)).toBe('Popup tên: —');
    expect(nameKeywordPopupLine({ ...base, kind: 'place', status: 'dropped', dropReason: 'gần popup khác' })).toBe('Popup tên: Sông Tiền (địa danh · AI)');
  });
});
