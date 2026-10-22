import type { Channel, CreateChannelRequest } from '../../../contracts/channel';
import { PUBLISH_SCHEDULE_STARTER, type PublishSchedule } from '../../../contracts/channel-schedule';
import { PublishScheduleSchema } from '../../../contracts/channel';

export const HISTORY_CHANNEL_PREFILL = {
  name: 'Lịch Sử Không Khô',
  handle: '@lichsukhongkho213',
  tagline: 'những nghịch lý ít ai để ý',
  language: 'vi',
} as const;

const LAST_USED_CHANNEL_KEY = 'video-tool:last-used-channel-id';

export type ChannelScheduleEditor = { timezone: string; slots: PublishSchedule['slots']; notes: string };

export function isChannelEditorDirty<T extends Record<string, unknown>>(current: T, saved: T): boolean {
  return JSON.stringify(current) !== JSON.stringify(saved);
}

export function profileRefreshNeedsConfirmation(isDirty: boolean): boolean {
  return isDirty;
}

export function channelScheduleEditor(schedule: PublishSchedule | null | undefined): ChannelScheduleEditor {
  return schedule
    ? { timezone: schedule.timezone, slots: schedule.slots.map((slot) => ({ ...slot })), notes: schedule.notes }
    : { timezone: 'Asia/Ho_Chi_Minh', slots: [], notes: '' };
}

export function scheduleFromEditor(value: ChannelScheduleEditor): PublishSchedule {
  return PublishScheduleSchema.parse({ timezone: value.timezone.trim(), slots: value.slots, notes: value.notes });
}

export function starterScheduleEditor(): ChannelScheduleEditor {
  return channelScheduleEditor(PUBLISH_SCHEDULE_STARTER);
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLastUsedChannelId(storage?: StorageLike | null): string | null {
  try {
    return resolveStorage(storage)?.getItem(LAST_USED_CHANNEL_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLastUsedChannelId(channelId: string | null, storage?: StorageLike | null): void {
  try {
    const target = resolveStorage(storage);
    if (!target) return;
    if (channelId) target.setItem(LAST_USED_CHANNEL_KEY, channelId);
    else target.removeItem(LAST_USED_CHANNEL_KEY);
  } catch {
    // Storage may be disabled by browser privacy settings; channel selection still works.
  }
}

export function parseChannelLinks(value: string): Array<{ label: string; url: string }> {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf('|');
    if (separator < 1) throw new Error('Mỗi liên kết cần có dạng nhãn | URL.');
    const label = line.slice(0, separator).trim();
    const url = line.slice(separator + 1).trim();
    if (!label || !url) throw new Error('Mỗi liên kết cần có nhãn và URL.');
    return { label, url };
  });
}

export function formatChannelLinks(channel: Channel): string {
  return channel.links.map(({ label, url }) => `${label} | ${url}`).join('\n');
}

export function channelEditorInput(value: {
  name: string;
  handle: string;
  tagline: string;
  description: string;
  language: 'vi' | 'en';
  linksText: string;
  defaultHashtagsText: string;
  descriptionFooter: string;
  aiDisclosureText: string;
  thumbnailTemplate: string;
  publishTimezone: string;
  publishSlots: PublishSchedule['slots'];
  publishNotes: string;
}): CreateChannelRequest {
  return {
    name: value.name.trim(),
    ...(value.handle.trim() ? { handle: value.handle.trim() } : {}),
    tagline: value.tagline,
    description: value.description,
    language: value.language,
    links: parseChannelLinks(value.linksText),
    defaultHashtags: value.defaultHashtagsText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    descriptionFooter: value.descriptionFooter,
    ...(value.aiDisclosureText.trim() ? { aiDisclosureText: value.aiDisclosureText } : {}),
    ...(value.thumbnailTemplate.trim() ? { thumbnailTemplate: value.thumbnailTemplate } : {}),
    publishSchedule: scheduleFromEditor({ timezone: value.publishTimezone, slots: value.publishSlots, notes: value.publishNotes }),
  };
}
