import type { YoutubeChannelDaily } from '../../../contracts/youtube';
import { buildChannelTrend } from './analysis';

export type YoutubeOverviewWindowMetrics = {
  views: number | null;
  estimatedMinutesWatched: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
};

export type YoutubeOverviewWindows = {
  last28: YoutubeOverviewWindowMetrics;
  previous28: YoutubeOverviewWindowMetrics;
  trend: ReturnType<typeof buildChannelTrend>;
};

const MISSING_WINDOW: YoutubeOverviewWindowMetrics = {
  views: null,
  estimatedMinutesWatched: null,
  subscribersGained: null,
  subscribersLost: null,
};

function sum(rows: readonly YoutubeChannelDaily[], select: (row: YoutubeChannelDaily) => number): number {
  return rows.reduce((total, row) => total + select(row), 0);
}

export function buildYoutubeOverviewWindows(daily: readonly YoutubeChannelDaily[], now = new Date()): YoutubeOverviewWindows {
  const trend = buildChannelTrend(daily, now);
  if (daily.length === 0) return { last28: MISSING_WINDOW, previous28: MISSING_WINDOW, trend };

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const currentStart = today - 28 * 86_400_000;
  const previousStart = today - 56 * 86_400_000;
  const current = daily.filter((row) => {
    const date = Date.parse(`${row.date}T00:00:00.000Z`);
    return date >= currentStart && date < today;
  });
  const previous = daily.filter((row) => {
    const date = Date.parse(`${row.date}T00:00:00.000Z`);
    return date >= previousStart && date < currentStart;
  });
  const metrics = (rows: readonly YoutubeChannelDaily[]): YoutubeOverviewWindowMetrics => ({
    views: sum(rows, (row) => row.views),
    estimatedMinutesWatched: sum(rows, (row) => row.estimatedMinutesWatched),
    subscribersGained: sum(rows, (row) => row.subscribersGained),
    subscribersLost: sum(rows, (row) => row.subscribersLost),
  });
  return { last28: metrics(current), previous28: metrics(previous), trend };
}
