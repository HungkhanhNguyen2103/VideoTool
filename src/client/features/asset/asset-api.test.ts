import { describe, expect, it } from 'vitest';
import { fileUrlForSummary } from './api';

describe('asset API helpers', () => {
  it('builds a files URL from the generated relative stored path', () => {
    expect(fileUrlForSummary({ storedPath: '01ARZ3NDEKTSV4RRFFQ69G5FAV.png' })).toBe('/files/01ARZ3NDEKTSV4RRFFQ69G5FAV.png');
  });

  it('rejects a path that could escape the files root', () => {
    expect(() => fileUrlForSummary({ storedPath: '../secret.png' })).toThrow('Invalid stored path');
  });
});
