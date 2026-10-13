import { describe, expect, it } from 'vitest';
import { PopupAiOutputSchema } from './output-schema';

describe('popup AI output schema', () => {
  it('accepts a complete verdict and a valid empty verdict', () => {
    expect(PopupAiOutputSchema.parse({ scenes: [{ scene: 1, needed: true, reason: 'Cần cho biết quy mô trận đánh.', popups: [{ scene: 1, kind: 'number', anchor: 'ba nghìn người', display: '3.000 quân', importance: 5, reason: 'Người xem cần biết quy mô lực lượng.' }] }, { scene: 2, needed: false, reason: 'Không có mốc mới quan trọng.', popups: [] }] }).scenes).toHaveLength(2);
  });

  it('rejects extra fields and invalid importance', () => {
    expect(() => PopupAiOutputSchema.parse({ scenes: [{ scene: 1, needed: false, reason: 'Không cần.', popups: [], extra: true }] })).toThrow();
    expect(() => PopupAiOutputSchema.parse({ scenes: [{ scene: 1, needed: true, reason: 'Cần.', popups: [{ scene: 1, kind: 'person', anchor: 'Nguyễn Huệ', display: 'Nguyễn Huệ', importance: 6, reason: 'Nhân vật.' }] }] })).toThrow();
  });
});
