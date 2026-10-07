import { describe, expect, it } from 'vitest';
import { logoLayout } from './logo-layout';
import {
  LANDSCAPE_NAME_LOWER_THIRD_MARGIN_BOTTOM,
  PORTRAIT_NAME_LOWER_THIRD_MARGIN_BOTTOM,
  nameLowerThirdLayout,
} from './keyword-layout';

describe('name lower-third layout', () => {
  it('raises the landscape and portrait lower thirds to the approved margins', () => {
    expect(LANDSCAPE_NAME_LOWER_THIRD_MARGIN_BOTTOM).toBe(0.17);
    expect(PORTRAIT_NAME_LOWER_THIRD_MARGIN_BOTTOM).toBe(0.21);
  });

  it('keeps the landscape name box horizontally clear of the bottom-right logo', () => {
    const [width, height] = [1920, 1080];
    const lowerThird = nameLowerThirdLayout(width, height);
    const logo = logoLayout(width, height);
    const lowerThirdRight = lowerThird.left + lowerThird.maxWidth;
    const logoLeft = width - logo.right - logo.width;
    expect(lowerThirdRight).toBeLessThan(logoLeft);
  });

  it('keeps the portrait lower-third box vertically above the bottom-right logo', () => {
    const [width, height] = [1080, 1920];
    const lowerThird = nameLowerThirdLayout(width, height);
    const logo = logoLayout(width, height);
    const conservativeLowerThirdHeight = Math.min(width, height) * 0.14;
    const lowerThirdBottom = height - lowerThird.bottom;
    const lowerThirdTop = lowerThirdBottom - conservativeLowerThirdHeight;
    const logoTop = height - logo.bottom - logo.height;
    expect(lowerThirdBottom).toBeLessThan(logoTop);
    expect(lowerThirdTop).toBeLessThan(lowerThirdBottom);
  });
});
