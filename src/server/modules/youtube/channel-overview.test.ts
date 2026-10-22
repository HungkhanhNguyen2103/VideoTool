import { describe, expect, it } from 'vitest';
import type { YoutubeChannelDaily } from '../../../contracts/youtube';
import { buildYoutubeOverviewWindows } from './channel-overview';

function day(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

describe('stored YouTube channel overview windows', () => {
  it('keeps missing daily series unavailable instead of turning it into zeroes', () => {
    const result = buildYoutubeOverviewWindows([]);
    expect(result.last28).toEqual({ views: null, estimatedMinutesWatched: null, subscribersGained: null, subscribersLost: null });
    expect(result.previous28).toEqual({ views: null, estimatedMinutesWatched: null, subscribersGained: null, subscribersLost: null });
    expect(result.trend.tooFewData).toBe(true);
  });

  it('aggregates stored windows and reuses the small-channel trend rule', () => {
    const rows: YoutubeChannelDaily[] = [
      { date: day(5), views: 150, estimatedMinutesWatched: 9_000, subscribersGained: 5, subscribersLost: 1 },
      { date: day(35), views: 100, estimatedMinutesWatched: 6_000, subscribersGained: 3, subscribersLost: 2 },
    ];
    const result = buildYoutubeOverviewWindows(rows);
    expect(result.last28).toEqual({ views: 150, estimatedMinutesWatched: 9_000, subscribersGained: 5, subscribersLost: 1 });
    expect(result.previous28).toEqual({ views: 100, estimatedMinutesWatched: 6_000, subscribersGained: 3, subscribersLost: 2 });
    expect(result.trend.views.changePercent).toBe(50);
    expect(result.trend.tooFewData).toBe(false);
  });

  it('keeps a zero previous window as an unavailable percentage instead of dividing by zero', () => {
    const result = buildYoutubeOverviewWindows([
      { date: day(5), views: 20, estimatedMinutesWatched: 0, subscribersGained: 0, subscribersLost: 0 },
    ]);
    expect(result.trend.views.changePercent).toBeNull();
    expect(result.trend.tooFewData).toBe(true);
  });
});
