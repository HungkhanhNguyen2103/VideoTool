import { z } from 'zod';

const timezoneSchema = z.string().trim().min(1).refine((timezone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}, 'Múi giờ phải là múi giờ IANA hợp lệ.');

const publishSlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  kind: z.enum(['long', 'short']),
}).strict();

export const PublishScheduleSchema = z.object({
  timezone: timezoneSchema.default('Asia/Ho_Chi_Minh'),
  slots: z.array(publishSlotSchema).max(14).default([]),
  notes: z.string().max(500).default(''),
}).strict().superRefine((schedule, context) => {
  const seen = new Set<string>();
  schedule.slots.forEach((slot, index) => {
    const key = `${slot.weekday}|${slot.time}|${slot.kind}`;
    if (seen.has(key)) {
      context.addIssue({ code: 'custom', path: ['slots', index], message: 'Không thể có hai khung giờ đăng giống nhau.' });
    }
    seen.add(key);
  });
});

export type PublishSchedule = z.infer<typeof PublishScheduleSchema>;

export const PUBLISH_LEAD_HOURS_MIN = 2;
export const PUBLISH_LEAD_HOURS_MAX = 4;

export const PUBLISH_SCHEDULE_STARTER: PublishSchedule = {
  timezone: 'Asia/Ho_Chi_Minh',
  slots: [
    { weekday: 2, time: '20:00', kind: 'long' },
    { weekday: 5, time: '20:00', kind: 'long' },
    { weekday: 0, time: '20:00', kind: 'long' },
    { weekday: 1, time: '12:00', kind: 'short' },
    { weekday: 2, time: '12:00', kind: 'short' },
    { weekday: 3, time: '12:00', kind: 'short' },
    { weekday: 4, time: '12:00', kind: 'short' },
    { weekday: 5, time: '12:00', kind: 'short' },
  ],
  notes: '',
};

export const PUBLISH_SCHEDULE_STARTER_WINDOWS = {
  long: '19:30–21:00',
  short: '11:30–12:30',
} as const;

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SEARCH_MS = 8 * 7 * DAY_MS;
const MAX_SLOT_COUNT = 10;
const OFFSET_SAMPLE_HOURS = [-48, -36, -24, -12, 0, 12, 24, 36, 48] as const;
const WEEKDAY_LABELS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const;

function createPartsFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function localParts(instant: Date, formatter: Intl.DateTimeFormat): LocalParts {
  const parts = formatter.formatToParts(instant);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number('year'), month: number('month'), day: number('day'), hour: number('hour'), minute: number('minute') };
}

function timezoneOffsetMs(instantMs: number, formatter: Intl.DateTimeFormat): number {
  const minuteMs = Math.floor(instantMs / 60_000) * 60_000;
  const parts = localParts(new Date(minuteMs), formatter);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - minuteMs;
}

function sameWallTime(parts: LocalParts, target: LocalParts): boolean {
  return parts.year === target.year
    && parts.month === target.month
    && parts.day === target.day
    && parts.hour === target.hour
    && parts.minute === target.minute;
}

function resolveWallTime(target: LocalParts, formatter: Intl.DateTimeFormat): number | undefined {
  const wallTimeAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const offsets = new Set(OFFSET_SAMPLE_HOURS.map((hours) => timezoneOffsetMs(wallTimeAsUtc + hours * 60 * 60 * 1000, formatter)));
  const candidates = [...offsets]
    .map((offset) => wallTimeAsUtc - offset)
    .filter((candidate) => sameWallTime(localParts(new Date(candidate), formatter), target));
  // A fall-back wall time may map to two instants; schedule only its first occurrence.
  return [...new Set(candidates)].sort((a, b) => a - b)[0];
}

/** Return future instants within eight weeks. DST gaps are skipped; folds choose the first occurrence. */
export function nextPublishSlots(
  schedule: PublishSchedule | null | undefined,
  now: Date,
  kind: 'long' | 'short',
  count: number,
): Date[] {
  const nowMs = now.getTime();
  const limit = Math.min(MAX_SLOT_COUNT, Math.max(0, Math.floor(count)));
  if (!Number.isFinite(nowMs) || limit === 0) return [];
  const parsed = PublishScheduleSchema.safeParse(schedule);
  if (!parsed.success || parsed.data.slots.length === 0) return [];

  const formatter = createPartsFormatter(parsed.data.timezone);
  const currentLocal = localParts(now, formatter);
  const firstDayUtc = Date.UTC(currentLocal.year, currentLocal.month - 1, currentLocal.day);
  const deadline = nowMs + MAX_SEARCH_MS;
  const instants = new Set<number>();

  for (let dayOffset = 0; dayOffset <= 56; dayOffset += 1) {
    const date = new Date(firstDayUtc + dayOffset * DAY_MS);
    const weekday = date.getUTCDay();
    for (const slot of parsed.data.slots) {
      if (slot.kind !== kind || slot.weekday !== weekday) continue;
      const [hourText = '0', minuteText = '0'] = slot.time.split(':');
      const hour = Number(hourText);
      const minute = Number(minuteText);
      const target = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute };
      const candidate = resolveWallTime(target, formatter);
      if (candidate !== undefined && candidate > nowMs && candidate <= deadline) instants.add(candidate);
    }
  }

  return [...instants].sort((a, b) => a - b).slice(0, limit).map((instant) => new Date(instant));
}

export function formatSlotLabel(instant: Date, timezone: string): string {
  const parts = localParts(instant, createPartsFormatter(timezone));
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${WEEKDAY_LABELS[weekday]} ${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}
