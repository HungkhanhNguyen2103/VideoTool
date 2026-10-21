import { describe, expect, it, vi } from 'vitest';
import {
  HISTORY_CHANNEL_PREFILL,
  channelScheduleEditor,
  parseChannelLinks,
  readLastUsedChannelId,
  scheduleFromEditor,
  starterScheduleEditor,
  writeLastUsedChannelId,
} from './channel-helpers';

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

  it('converts an API schedule to form state and back to the strict payload', () => {
    const schedule = { timezone: 'America/New_York', slots: [{ weekday: 0, time: '01:30', kind: 'long' as const }], notes: 'DST aware' };

    expect(channelScheduleEditor(schedule)).toEqual(schedule);
    expect(scheduleFromEditor(channelScheduleEditor(schedule))).toEqual(schedule);
  });

  it('uses the default timezone and an empty schedule for a channel without one', () => {
    expect(channelScheduleEditor(null)).toEqual({ timezone: 'Asia/Ho_Chi_Minh', slots: [], notes: '' });
  });

  it('prefills the starter schedule in editor state only', () => {
    const editor = starterScheduleEditor();

    expect(editor.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(editor.slots.filter((slot) => slot.kind === 'long').map((slot) => [slot.weekday, slot.time]))
      .toEqual([[2, '20:00'], [5, '20:00'], [0, '20:00']]);
    expect(editor.slots.filter((slot) => slot.kind === 'short').map((slot) => [slot.weekday, slot.time]))
      .toEqual([[1, '12:00'], [2, '12:00'], [3, '12:00'], [4, '12:00'], [5, '12:00']]);
    expect(editor.notes).toBe('');
  });
});
