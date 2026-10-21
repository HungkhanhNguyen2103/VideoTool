import { describe, expect, it } from 'vitest';
import { parseSourceReferences } from './seo-sources';

describe('SEO source references', () => {
  it('parses numbered source lines with colon, dash, parenthesis, and bare URLs', () => {
    expect(parseSourceReferences([
      '[1] Sử liệu triều Nguyễn: https://example.org/a',
      '[2] Archive record - https://example.org/b',
      '3. Tài liệu lưu trữ – https://example.org/c',
      '4) Official report: https://example.org/d',
      '5. https://example.org/e',
      '[6] https://example.org/f',
    ].join('\n'))).toEqual([
      { title: 'Sử liệu triều Nguyễn', url: 'https://example.org/a' },
      { title: 'Archive record', url: 'https://example.org/b' },
      { title: 'Tài liệu lưu trữ', url: 'https://example.org/c' },
      { title: 'Official report', url: 'https://example.org/d' },
      { title: '', url: 'https://example.org/e' },
      { title: '', url: 'https://example.org/f' },
    ]);
  });

  it('requires a numbered line and an HTTP or HTTPS URL', () => {
    expect(parseSourceReferences([
      'Plain title: https://example.org/no-number',
      '1. Title without a link',
      '2. ftp://example.org/archive',
      '3) javascript:alert(1)',
      '[4] Title: https://example.org/valid',
    ].join('\n'))).toEqual([{ title: 'Title', url: 'https://example.org/valid' }]);
  });

  it('strips URL punctuation, keeps the first URL duplicate, preserves title text, and caps at eight', () => {
    const input = [
      '[1]  Tên được giữ nguyên  : https://example.org/a.,;)',
      '2. Duplicate: https://example.org/a',
      ...Array.from({ length: 9 }, (_, index) => `${index + 3}. Nguồn ${index}: https://example.org/${index + 1}`),
    ].join('\n');
    const parsed = parseSourceReferences(input);

    expect(parsed).toHaveLength(8);
    expect(parsed[0]).toEqual({ title: 'Tên được giữ nguyên', url: 'https://example.org/a' });
    expect(parsed.some((item) => item.title === 'Duplicate')).toBe(false);
  });
});
