import { describe, expect, it } from 'vitest';
import { SEO_HASHTAGS_MAX_COUNT, SeoPackageSchema, SeoPatchSchema, normalizeHashtag, normalizeHashtags } from './seo';

describe('SEO contracts', () => {
  it('parses an empty package with all legacy-safe defaults', () => {
    expect(SeoPackageSchema.parse({})).toEqual({
      titles: [],
      chosenTitleId: null,
      descriptionIntro: '',
      descriptionKeywords: '',
      tags: [],
      hashtags: [],
      pinnedComment: '',
      thumbnail: { ideas: [], chosenIdeaId: null, fileId: null },
      generatedBy: null,
    });
  });

  it('parses legacy SEO packages without description keywords', () => {
    expect(SeoPackageSchema.parse({ descriptionIntro: 'Intro.' }).descriptionKeywords).toBe('');
  });

  it('accepts description keywords up to 800 characters and rejects longer values', () => {
    expect(SeoPackageSchema.safeParse({ descriptionKeywords: 'k'.repeat(800) }).success).toBe(true);
    expect(SeoPackageSchema.safeParse({ descriptionKeywords: 'k'.repeat(801) }).success).toBe(false);
  });

  it('accepts description keywords in a partial SEO patch', () => {
    expect(SeoPatchSchema.parse({ descriptionKeywords: 'Từ khóa tự nhiên.' })).toEqual({ descriptionKeywords: 'Từ khóa tự nhiên.' });
  });

  it('normalizes pasted hashtags to accent-free CamelCase and removes duplicates', () => {
    expect(normalizeHashtag('Điện Biên Phủ')).toBe('#DienBienPhu');
    expect(normalizeHashtags(['Điện Biên Phủ', '#DienBienPhu', '#lich su', '#LichSu'])).toEqual(['#DienBienPhu', '#LichSu']);
    expect(normalizeHashtags(['#LichSu', '#DienBienPhu'], ['lịch sử'])).toEqual(['#DienBienPhu']);
  });

  it('rejects more than fifteen hashtags and hashtags repeated in tags', () => {
    const tooMany = Array.from({ length: SEO_HASHTAGS_MAX_COUNT + 1 }, (_, index) => `#Tag${index + 1}`);
    expect(SeoPackageSchema.safeParse({ hashtags: tooMany }).success).toBe(false);
    expect(SeoPackageSchema.safeParse({ tags: ['lịch sử'], hashtags: ['#LichSu'] }).success).toBe(false);
  });
});
