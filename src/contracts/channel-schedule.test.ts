import { describe, expect, it } from 'vitest';
import { formatSlotLabel, nextPublishSlots, type PublishSchedule } from './channel-schedule';

function schedule(
  timezone: string,
  slots: PublishSchedule['slots'],
): PublishSchedule {
  return { timezone, slots, notes: '' };
}

describe('channel publishing schedule helpers', () => {
  it('finds a Monday slot after a Sunday night in Ho Chi Minh City', () => {
    const value = schedule('Asia/Ho_Chi_Minh', [{ weekday: 1, time: '12:00', kind: 'long' }]);
    const now = new Date('2026-10-18T16:00:00.000Z');
    const slots = nextPublishSlots(value, now, 'long', 1);

    expect(slots.map((slot) => slot.toISOString())).toEqual(['2026-10-19T05:00:00.000Z']);
    expect(nextPublishSlots(value, now, 'long', 1)).toEqual(slots);
  });

  it('excludes a slot equal to now and filters by video kind', () => {
    const value = schedule('Asia/Ho_Chi_Minh', [
      { weekday: 1, time: '12:00', kind: 'long' },
      { weekday: 1, time: '13:00', kind: 'short' },
    ]);

    expect(nextPublishSlots(value, new Date('2026-10-19T05:00:00.000Z'), 'long', 1).map((slot) => slot.toISOString()))
      .toEqual(['2026-10-26T05:00:00.000Z']);
    expect(nextPublishSlots(value, new Date('2026-10-18T16:00:00.000Z'), 'short', 1).map((slot) => slot.toISOString()))
      .toEqual(['2026-10-19T06:00:00.000Z']);
  });

  it('returns no slots for invalid or empty schedules and caps count at ten', () => {
    const dense = schedule('Asia/Ho_Chi_Minh', Array.from({ length: 14 }, (_, index) => ({
      weekday: Math.floor(index / 2),
      time: index % 2 === 0 ? '10:00' : '11:00',
      kind: 'long' as const,
    })));
    const invalid = { ...dense, timezone: 'Mars/Olympus' } as PublishSchedule;

    expect(nextPublishSlots(null as unknown as PublishSchedule, new Date('2026-10-18T00:00:00.000Z'), 'long', 3)).toEqual([]);
    expect(nextPublishSlots(invalid, new Date('2026-10-18T00:00:00.000Z'), 'long', 3)).toEqual([]);
    expect(nextPublishSlots(schedule('Asia/Ho_Chi_Minh', []), new Date('2026-10-18T00:00:00.000Z'), 'long', 3)).toEqual([]);
    expect(nextPublishSlots(dense, new Date('2026-10-18T00:00:00.000Z'), 'long', 15)).toHaveLength(10);
  });

  it('searches no farther than eight weeks ahead', () => {
    const value = schedule('Asia/Ho_Chi_Minh', [{ weekday: 0, time: '20:00', kind: 'long' }]);
    const slots = nextPublishSlots(value, new Date('2026-10-18T12:00:00.000Z'), 'long', 10);

    expect(slots.map((slot) => slot.toISOString())).toEqual([
      '2026-10-18T13:00:00.000Z',
      '2026-10-25T13:00:00.000Z',
      '2026-11-01T13:00:00.000Z',
      '2026-11-08T13:00:00.000Z',
      '2026-11-15T13:00:00.000Z',
      '2026-11-22T13:00:00.000Z',
      '2026-11-29T13:00:00.000Z',
      '2026-12-06T13:00:00.000Z',
    ]);
  });

  it('skips a nonexistent spring-forward time and selects the first fall-back occurrence', () => {
    const spring = schedule('America/New_York', [{ weekday: 0, time: '02:30', kind: 'long' }]);
    const fall = schedule('America/New_York', [{ weekday: 0, time: '01:30', kind: 'long' }]);

    expect(nextPublishSlots(spring, new Date('2026-03-07T00:00:00.000Z'), 'long', 1).map((slot) => slot.toISOString()))
      .toEqual(['2026-03-15T06:30:00.000Z']);
    expect(nextPublishSlots(fall, new Date('2026-10-31T00:00:00.000Z'), 'long', 3).map((slot) => slot.toISOString()))
      .toEqual(['2026-11-01T05:30:00.000Z', '2026-11-08T06:30:00.000Z', '2026-11-15T06:30:00.000Z']);
  });

  it('formats a slot as a Vietnamese weekday and local date/time', () => {
    expect(formatSlotLabel(new Date('2026-10-20T13:00:00.000Z'), 'Asia/Ho_Chi_Minh'))
      .toBe('Thứ Ba 20/10/2026 20:00');
  });
});
