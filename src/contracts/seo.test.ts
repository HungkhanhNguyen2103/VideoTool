import { describe, expect, it } from 'vitest';
import { SEO_HASHTAGS_MAX_COUNT, SEO_SECTIONS, SeoPackageSchema, SeoPatchSchema, ensureShortsHashtag, normalizeHashtag, normalizeHashtags } from './seo';

describe('SEO contracts', () => {
  it('includes Shorts in the shared section enum while keeping legacy package defaults', () => {
    expect(SEO_SECTIONS).toEqual(['titles', 'description', 'tags', 'pinnedComment', 'thumbnail', 'shorts']);
  });
  it('parses an empty package with all legacy-safe defaults', () => {
    expect(SeoPackageSchema.parse({})).toEqual({
      titles: [],
      chosenTitleId: null,
      descriptionIntro: '',
      descriptionKeywords: '',
      tags: [],
      hashtags: [],
      shorts: [],
      longVideoUrl: '',
      pinnedComment: '',
      thumbnail: { ideas: [], chosenIdeaId: null, fileId: null },
      generatedBy: null,
    });
  });

  it('parses legacy SEO packages without description keywords', () => {
    expect(SeoPackageSchema.parse({ descriptionIntro: 'Intro.' }).descriptionKeywords).toBe('');
  });

  it('defaults legacy generatedBy metadata to the API backend while preserving manual metadata', () => {
    const generatedBy = { provider: 'claude', model: 'claude-opus-4-5', promptVersion: 'seo-v1', generatedAt: '2026-10-22T00:00:00.000Z' };
    expect(SeoPackageSchema.parse({ generatedBy }).generatedBy).toMatchObject({ backend: 'api' });
    expect(SeoPackageSchema.parse({ generatedBy: { ...generatedBy, backend: 'cli' } }).generatedBy).toMatchObject({ backend: 'cli' });
    expect(SeoPackageSchema.parse({ generatedBy: { ...generatedBy, provider: 'manual' } }).generatedBy).not.toHaveProperty('backend');
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

  it('guarantees canonical Shorts hashtags including #Shorts within the five-tag cap', () => {
    expect(ensureShortsHashtag(['#lich su', '#Shorts', '#Dien Bien Phu'])).toEqual(['#LichSu', '#Shorts', '#DienBienPhu']);
    expect(ensureShortsHashtag(['#one', '#two', '#three', '#four', '#five'])).toEqual(['#One', '#Two', '#Three', '#Four', '#Shorts']);
    expect(SeoPackageSchema.parse({ shorts: [{ id: 'short-a', startSec: 0, endSec: 30, chapterNo: 1, hookLine: 'Hook', title: 'Title', caption: 'Caption', hashtags: ['#one'], reason: 'Reason' }] }).shorts[0]?.hashtags).toEqual(['#One', '#Shorts']);
  });

  it.each([
    { label: 'index 0', input: ['#Shorts', '#A', '#B', '#C', '#D', '#E'], expected: ['#Shorts', '#A', '#B', '#C', '#D'] },
    { label: 'index 2', input: ['#A', '#B', '#Shorts', '#C', '#D', '#E'], expected: ['#A', '#B', '#Shorts', '#C', '#D'] },
    { label: 'index 6', input: ['#A', '#B', '#C', '#D', '#E', '#F', '#Shorts'], expected: ['#A', '#B', '#C', '#D', '#Shorts'] },
    { label: 'no #Shorts and six inputs', input: ['#A', '#B', '#C', '#D', '#E', '#F'], expected: ['#A', '#B', '#C', '#D', '#Shorts'] },
    { label: 'case and accent variants', input: ['#A', '#shorts', '#SHORTS', '#Shórts', '#B'], expected: ['#A', '#Shorts', '#B'] },
  ])('always retains canonical #Shorts for $label', ({ input, expected }) => {
    expect(ensureShortsHashtag(input)).toEqual(expected);
  });

  it('defaults new fields for legacy packages and validates long video URLs', () => {
    expect(SeoPackageSchema.parse({}).shorts).toEqual([]);
    expect(SeoPackageSchema.parse({}).longVideoUrl).toBe('');
    expect(SeoPatchSchema.safeParse({ longVideoUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(SeoPatchSchema.safeParse({ longVideoUrl: 'https://example.com/video' }).success).toBe(true);
    expect(SeoPackageSchema.safeParse({ shorts: [{ id: 'x', startSec: 3, endSec: 2, chapterNo: 1, hookLine: '', title: '', caption: '', hashtags: ['#Shorts'], reason: '' }] }).success).toBe(false);
    const short = { id: 'short', startSec: 0, endSec: 30, chapterNo: 1, hookLine: '', title: '', caption: '', hashtags: ['#Shorts'], reason: '' };
    expect(SeoPackageSchema.safeParse({ shorts: [short, short, short, short] }).success).toBe(false);
    expect(SeoPackageSchema.safeParse({ shorts: [{ ...short, hashtags: ['#A', '#B', '#C', '#D', '#E', '#Shorts'] }] }).success).toBe(false);
  });
});
