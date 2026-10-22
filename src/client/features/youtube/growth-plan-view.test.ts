import { describe, expect, it } from 'vitest';
import { YoutubeGrowthPlanConfigSchema } from '../../../contracts/youtube-plan';
import { checkpointStatusLabel, formatGrowthDate, formatGrowthInterval, formatGrowthNumber, growthProgress, growthStageLabel, growthVerdictLabel, parseGrowthPlanForm } from './growth-plan-view';

describe('growth plan client helpers', () => {
  it('formats Vietnamese values, dates, hit intervals, and labels', () => {
    const hit = YoutubeGrowthPlanConfigSchema.parse({});
    expect(formatGrowthNumber(1_234.5)).toBe('1.234,5');
    expect(formatGrowthDate('2026-10-20')).toMatch(/20/);
    expect(formatGrowthDate(null)).toBe('Chưa có dữ liệu');
    expect(formatGrowthInterval({ hits: 0, count: 5, rate: 0, low: 0, high: 0.6, videosUntilHit: null, ruleOfThreeUpperBound: 0.6, approximate: false, message: 'small' }, hit.viewTargets.first)).toContain('ước lượng chưa có ý nghĩa');
    expect(formatGrowthInterval({ hits: 2, count: 12, rate: 1 / 6, low: 0.05, high: 0.45, videosUntilHit: { min: 2.2, max: 20 }, ruleOfThreeUpperBound: null, approximate: false }, 500)).toContain('Cần khoảng 2,2–20 video nữa');
    expect(growthVerdictLabel('consider_stop')).toBe('Cân nhắc dừng ngách');
    expect(growthStageLabel('C')).toContain('C ·');
    expect(checkpointStatusLabel('passed')).toBe('Đã qua');
  });

  it('clamps progress and validates form input with the shared contract', () => {
    expect(growthProgress(1_200, 1_000)).toBe(1);
    expect(growthProgress(250, 1_000)).toBe(0.25);
    expect(growthProgress(null, 1_000)).toBeNull();
    expect(() => parseGrowthPlanForm({ nicheStartDate: '2026-02-30', cadencePerWeek: 3.5 })).toThrow();
    expect(parseGrowthPlanForm({ nicheStartDate: '2026-10-20', cadencePerWeek: 3.5 }).viewTargets.first).toBe(500);
  });
});
