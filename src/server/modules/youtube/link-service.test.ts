import { describe, expect, it } from 'vitest';
import { compareYoutubeTitleLink } from './link-service';

describe('YouTube project link suggestions', () => {
  it('matches Vietnamese titles after SEO normalization and reports close publish dates', () => {
    const exact = compareYoutubeTitleLink('Điện Biên Phủ: Trận Đỏ', 'dien-bien-phu tran do', 10);
    expect(exact).toMatchObject({ titleMatch: 'exact', dateWithinThirtyDays: true });
    expect(exact.score).toBeCloseTo(1.83);
    expect(compareYoutubeTitleLink('Bí mật chiến lược Điện Biên Phủ', 'Bí mật chiến lược Điện Biên Phủ năm 1954', 60).titleMatch).toBe('containment');
    expect(compareYoutubeTitleLink('Trận Đỏ', 'Một tiêu đề khác', 45)).toMatchObject({ titleMatch: 'none', dateWithinThirtyDays: false });
  });
});
