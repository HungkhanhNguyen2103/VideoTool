import { describe, expect, it, vi } from 'vitest';
import { HISTORY_CHANNEL_PREFILL, parseChannelLinks, readLastUsedChannelId, writeLastUsedChannelId } from './channel-helpers';

describe('channel helpers', () => {
  it('provides the requested Lịch Sử Không Khô prefill values without saving', () => {
    expect(HISTORY_CHANNEL_PREFILL).toEqual({
      name: 'Lịch Sử Không Khô',
      handle: '@lichsukhongkho213',
      tagline: 'những nghịch lý ít ai để ý',
      language: 'vi',
    });
  });

  it('stores and reads the last channel and silently handles unavailable storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn((key: string) => { values.delete(key); }),
    };
    writeLastUsedChannelId('channel-1', storage);
    expect(readLastUsedChannelId(storage)).toBe('channel-1');
    writeLastUsedChannelId(null, storage);
    expect(readLastUsedChannelId(storage)).toBeNull();

    const unavailable = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(readLastUsedChannelId(unavailable)).toBeNull();
    expect(() => writeLastUsedChannelId('channel-2', unavailable)).not.toThrow();
  });

  it('parses and formats newline-separated label and URL pairs', () => {
    expect(parseChannelLinks('Trang chủ | https://example.com\n\nYouTube | https://youtube.com/@test'))
      .toEqual([{ label: 'Trang chủ', url: 'https://example.com' }, { label: 'YouTube', url: 'https://youtube.com/@test' }]);
  });
});
