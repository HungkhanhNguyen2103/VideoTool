import { describe, expect, it } from 'vitest';
import { buildPopupAnalysisPrompt, POPUP_AI_OUTPUT_JSON_SCHEMA } from './build-prompt';

describe('popup analysis prompt', () => {
  it.each([
    ['low', 'chỉ những dữ kiện người xem không thể theo dõi nếu thiếu popup'],
    ['medium', 'thêm ngữ cảnh hữu ích'],
    ['high', 'rộng rãi'],
  ] as const)('includes density strictness wording for %s', (density, wording) => {
    const prompt = buildPopupAnalysisPrompt({ title: 'Tựa đề', brief: 'Brief', referencesText: 'Nguồn', language: 'vi', density, scenes: [{ scene: 1, startSec: 0, narration: 'Ba nghìn người đến.' }] });
    expect(prompt).toContain(wording);
  });

  it('embeds the strict output schema and one needed/not-needed example', () => {
    const prompt = buildPopupAnalysisPrompt({ title: 'Tựa đề', brief: 'Brief', referencesText: 'Nguồn', language: 'vi', density: 'low', scenes: [{ scene: 12, startSec: 0, narration: 'Ba nghìn người đến.' }] });
    expect(prompt).toContain(`EXACT JSON SCHEMA: ${JSON.stringify(POPUP_AI_OUTPUT_JSON_SCHEMA)}`);
    expect(prompt).toContain('"scene"');
    expect(prompt).toContain('"needed"');
    expect(prompt).toContain('"popups"');
    expect(prompt).toContain('"needed":false');
    expect(prompt).toContain('Mỗi PRIMARY scene phải xuất hiện đúng một lần');
    expect(prompt).toContain('display chỉ được có một con số duy nhất kèm danh từ');
    expect(prompt).toContain('3.000 quân');
  });

  it('omits inactive scenes from popup analysis prompt context', () => {
    const prompt = buildPopupAnalysisPrompt({
      title: 'Title', brief: 'Brief', referencesText: 'Sources', language: 'en', density: 'low',
      scenes: [
        { scene: 1, startSec: 0, narration: 'INACTIVE_SENTINEL', active: false },
        { scene: 2, startSec: 1, narration: 'ACTIVE_SENTINEL' },
      ],
    });

    expect(prompt).not.toContain('INACTIVE_SENTINEL');
    expect(prompt).toContain('ACTIVE_SENTINEL');
  });
});
