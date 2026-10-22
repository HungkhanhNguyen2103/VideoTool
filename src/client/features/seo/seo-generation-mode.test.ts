import { describe, expect, it } from 'vitest';
import { SEO_CLI_NOTE, seoGenerationAvailability } from './seo-generation-mode';

describe('SEO generation mode', () => {
  it('keeps API generation enabled and explains pending or unavailable CLI status', () => {
    expect(seoGenerationAvailability('api', undefined)).toEqual({ disabled: false, reason: undefined });
    expect(seoGenerationAvailability('cli', undefined)).toMatchObject({ disabled: true, reason: expect.stringContaining('Đang kiểm tra') });
    expect(seoGenerationAvailability('cli', { available: false, reason: 'Phiên đăng nhập đã hết hạn.', authPathLikely: 'subscription' }))
      .toEqual({ disabled: true, reason: 'Phiên đăng nhập đã hết hạn.' });
    expect(seoGenerationAvailability('cli', { available: true, authPathLikely: 'subscription' })).toEqual({ disabled: false, reason: undefined });
    expect(SEO_CLI_NOTE).toContain('Dùng Claude Code đã đăng nhập trên máy');
  });
});
