import { describe, expect, it } from 'vitest';
import { SEO_HASHTAGS_MAX_COUNT, SeoPackageSchema, normalizeHashtag, normalizeHashtags } from './seo';

describe('SEO contracts', () => {
  it('parses an empty package with all legacy-safe defaults', () => {
    expect(SeoPackageSchema.parse({})).toEqual({
      titles: [],
      chosenTitleId: null,
      descriptionIntro: '',
      tags: [],
      hashtags: [],
      pinnedComment: '',
      thumbnail: { ideas: [], chosenIdeaId: null, fileId: null },
      generatedBy: null,
    });
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
