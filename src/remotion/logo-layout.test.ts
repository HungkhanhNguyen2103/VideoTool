import { describe, expect, it } from 'vitest';
import { LOGO_OPACITY, logoLayout } from './logo-layout';

describe('logo layout', () => {
  it('exports the requested watermark opacity', () => {
    expect(LOGO_OPACITY).toBe(0.25);
  });

  it.each([
    [1920, 1080, 194.4, 43.2],
    [1080, 1920, 194.4, 43.2],
    [1080, 1080, 194.4, 43.2],
  ])('uses the minimum dimension for %dx%d', (width, height, size, margin) => {
    expect(logoLayout(width, height)).toEqual({ width: size, height: size, right: margin, bottom: margin });
  });
});
