import { describe, expect, it } from 'vitest';
import { loadPopupPreset } from './loader';

describe('popup preset loader', () => {
  it('accepts the checked-in CRLF preset frontmatter', () => {
    expect(loadPopupPreset()).toMatchObject({ id: 'popup-analysis', version: 2 });
  });
});
