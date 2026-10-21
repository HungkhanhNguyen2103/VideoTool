import { describe, expect, it } from 'vitest';
import {
  ChannelSchema,
  ChannelSummarySchema,
  CreateChannelRequestSchema,
  UpdateChannelRequestSchema,
} from './channel';

describe('channel contracts', () => {
  it('defaults the optional profile fields and placeholder schedule', () => {
    const channel = CreateChannelRequestSchema.parse({ name: 'Lịch Sử' });
    expect(channel).toMatchObject({
      language: 'vi',
      links: [],
      defaultHashtags: [],
      descriptionFooter: '',
      publishSchedule: null,
    });
  });

  it('normalizes and caps default hashtags', () => {
    expect(CreateChannelRequestSchema.parse({ name: 'History', defaultHashtags: ['lịch sử', '#LichSu', 'Điện Biên'] }).defaultHashtags)
      .toEqual(['#LichSu', '#DienBien']);
    expect(CreateChannelRequestSchema.parse({ name: 'History', defaultHashtags: ['a', 'b', 'c', 'd', 'e', 'f'] }).defaultHashtags)
      .toHaveLength(5);
  });

  it('enforces profile text limits and YouTube handle syntax', () => {
    expect(() => CreateChannelRequestSchema.parse({ name: '', tagline: 'x'.repeat(201) })).toThrow();
    expect(() => CreateChannelRequestSchema.parse({ name: 'History', handle: '@ab' })).toThrow();
    expect(() => CreateChannelRequestSchema.parse({ name: 'History', handle: 'history-channel' })).toThrow();
    expect(CreateChannelRequestSchema.parse({ name: 'History', handle: '@lich.su_213' }).handle).toBe('@lich.su_213');
  });

  it('accepts only HTTP and HTTPS profile links', () => {
    expect(CreateChannelRequestSchema.parse({ name: 'History', links: [{ label: 'Site', url: 'https://example.com' }] }).links)
      .toEqual([{ label: 'Site', url: 'https://example.com' }]);
    expect(() => CreateChannelRequestSchema.parse({ name: 'History', links: [{ label: 'Site', url: 'javascript:alert(1)' }] })).toThrow();
    expect(() => CreateChannelRequestSchema.parse({ name: 'History', links: Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, url: 'https://example.com' })) })).toThrow();
  });

  it('keeps persisted and summary shapes strict while allowing legacy optional profile fields', () => {
    const persisted = {
      id: 'channel-1', name: 'History', language: 'vi', links: [], defaultHashtags: [], descriptionFooter: '',
      createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    };
    expect(ChannelSchema.parse(persisted).publishSchedule).toBeNull();
    expect(ChannelSummarySchema.parse({ id: 'channel-1', name: 'History' })).toMatchObject({ name: 'History' });
    expect(() => ChannelSchema.parse({ ...persisted, unknown: true })).toThrow();
    expect(UpdateChannelRequestSchema.parse({ handle: null })).toEqual({ handle: null });
  });

  it('validates schedule input and degrades malformed legacy schedules to null on reads', () => {
    const schedule = {
      timezone: 'Asia/Ho_Chi_Minh',
      slots: [{ weekday: 2, time: '20:00', kind: 'long' }],
      notes: 'Ưu tiên video dài.',
    };
    expect(CreateChannelRequestSchema.parse({ name: 'History', publishSchedule: schedule }).publishSchedule).toEqual(schedule);
    expect(() => CreateChannelRequestSchema.parse({ name: 'History', publishSchedule: {
      ...schedule,
      slots: [schedule.slots[0], schedule.slots[0]],
    } })).toThrow();
    expect(() => CreateChannelRequestSchema.parse({ name: 'History', publishSchedule: { ...schedule, extra: true } })).toThrow();
    expect(() => UpdateChannelRequestSchema.parse({ publishSchedule: { ...schedule, timezone: 'Mars/Olympus' } })).toThrow();

    const persisted = {
      id: 'channel-1', name: 'History', language: 'vi', links: [], defaultHashtags: [], descriptionFooter: '',
      publishSchedule: { corrupt: true },
      createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    };
    expect(ChannelSchema.parse(persisted).publishSchedule).toBeNull();
  });
});
