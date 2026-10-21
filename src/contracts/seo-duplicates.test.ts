import { describe, expect, it } from 'vitest';
import { findDuplicateTitle, normalizeSeoTitleForComparison } from './seo-duplicates';

describe('SEO duplicate-title matching', () => {
  it('exposes the shared accent-insensitive comparison normalizer', () => {
    expect(normalizeSeoTitleForComparison('Vì Sao Việt Nam?')).toBe('visaovietnam');
  });

  it('matches equal titles after accent, case, and punctuation normalization', () => {
    expect(findDuplicateTitle('Điện Biên Phủ: Trận Đỏ', ['dien-bien-phu tran do', 'Một tiêu đề khác']))
      .toEqual(['dien-bien-phu tran do']);
  });

  it('matches containment only when the shorter normalized title has at least twelve characters', () => {
    expect(findDuplicateTitle('abcde1234567', ['prefix-abcde1234567-suffix'])).toEqual(['prefix-abcde1234567-suffix']);
    expect(findDuplicateTitle('battle1945', ['prefix-battle1945-suffix'])).toEqual([]);
  });

  it('ignores blank titles and blank candidates', () => {
    expect(findDuplicateTitle(' !!! ', ['   ', '???'])).toEqual([]);
    expect(findDuplicateTitle('', ['A real title'])).toEqual([]);
  });
});
