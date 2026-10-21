import { describe, expect, it } from 'vitest';
import { emptySeoPackage } from '../../../contracts/seo';
import type { ProjectDetail } from '../../../contracts/project';
import { buildSeoDisplay, descriptionLengthGuidance, descriptionWordCount, saveStateLabel, TITLE_ANGLE_LABELS } from './seo-view';

function projectWithSeo(overrides: Partial<ProjectDetail['seo']> = {}): ProjectDetail {
  return {
    title: 'Điện Biên Phủ',
    brief: 'Chiến dịch Điện Biên Phủ năm 1954.',
    referencesText: 'Năm 1954, chiến dịch kéo dài 56 ngày.',
    seo: { ...emptySeoPackage(), ...overrides },
    scenes: [],
    chapters: [],
    renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: 24 },
  } as unknown as ProjectDetail;
}

describe('SEO client display helpers', () => {
  it('keeps schema angles in English while exposing one Vietnamese label map', () => {
    expect(TITLE_ANGLE_LABELS).toEqual({
      number: 'Con số', curiosity: 'Tò mò', stakes: 'Được–mất', question: 'Câu hỏi', contrarian: 'Phản biện',
    });
  });

  it('builds the selected title, full description, and fact warnings from project data', () => {
    const project = projectWithSeo({
      titles: [{ id: 'title-1', text: 'Điện Biên Phủ năm 1954', angle: 'number' }],
      chosenTitleId: 'title-1',
      descriptionIntro: 'Chiến dịch kéo dài 56 ngày.',
      hashtags: ['#DienBienPhu'],
    });
    const display = buildSeoDisplay(project);
    expect(display.selectedTitle?.text).toBe('Điện Biên Phủ năm 1954');
    expect(display.description).toContain('Chiến dịch kéo dài 56 ngày.');
    expect(display.description).toContain('#DienBienPhu');
    expect(display.unsupportedFacts).toEqual([]);
  });

  it('labels the debounce save states without losing an error state', () => {
    expect(saveStateLabel('idle')).toBe('');
    expect(saveStateLabel('saving')).toBe('Đang lưu…');
    expect(saveStateLabel('saved')).toBe('Đã lưu');
    expect(saveStateLabel('error')).toBe('Lỗi lưu (thử lại)');
  });

  it('counts assembled description words and gives only a soft unverified length hint', () => {
    expect(descriptionWordCount('  Một   hai\nba  ')).toBe(3);
    expect(descriptionWordCount('  ')).toBe(0);
    expect(descriptionLengthGuidance('one '.repeat(160))).toMatchObject({
      wordCount: 160,
      minWords: 150,
      maxWords: 300,
      inSuggestedRange: true,
      hint: 'gợi ý 150–300 từ, chưa kiểm chứng',
    });
    expect(descriptionLengthGuidance('too short').inSuggestedRange).toBe(false);
  });
});
