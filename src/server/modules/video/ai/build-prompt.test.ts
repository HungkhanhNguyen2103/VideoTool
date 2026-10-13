import { describe, expect, it } from 'vitest';
import { buildPopupAnalysisPrompt } from './build-prompt';

describe('popup analysis prompt', () => {
  it.each([
    ['low', 'chỉ những dữ kiện người xem không thể theo dõi nếu thiếu popup'],
    ['medium', 'thêm ngữ cảnh hữu ích'],
    ['high', 'rộng rãi'],
  ] as const)('includes density strictness wording for %s', (density, wording) => {
    const prompt = buildPopupAnalysisPrompt({ title: 'Tựa đề', brief: 'Brief', referencesText: 'Nguồn', language: 'vi', density, scenes: [{ scene: 1, startSec: 0, narration: 'Ba nghìn người đến.' }] });
    expect(prompt).toContain(wording);
  });
});
