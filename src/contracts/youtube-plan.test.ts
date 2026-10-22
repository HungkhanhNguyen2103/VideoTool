import { describe, expect, it } from 'vitest';
import { YoutubeGrowthPlanConfigSchema, YoutubeGrowthExperimentInputSchema } from './youtube-plan';

describe('YouTube growth plan contracts', () => {
  it('provides the documented safe defaults without choosing a niche date', () => {
    expect(YoutubeGrowthPlanConfigSchema.parse({})).toMatchObject({
      nicheStartDate: null,
      cadencePerWeek: 3.5,
      viewTargets: { first: 500, strong: 1_000 },
      assumedAvgViewDurationMin: 4,
      toleranceMonths: 18,
      warnAtMatureVideos: 15,
      decideAtMatureVideos: 40,
      decideMinMonths: 4,
      hardReviewWeek: 26,
      minExperimentsBeforeStop: 2,
      submittedForReviewAt: null,
    });
  });

  it('rejects invalid cadence, target ordering, unknown fields, and oversized experiment notes', () => {
    expect(() => YoutubeGrowthPlanConfigSchema.parse({ cadencePerWeek: 15 })).toThrow();
    expect(() => YoutubeGrowthPlanConfigSchema.parse({ viewTargets: { first: 1_000, strong: 500 } })).toThrow();
    expect(() => YoutubeGrowthPlanConfigSchema.parse({ unexpected: true })).toThrow();
    expect(() => YoutubeGrowthExperimentInputSchema.parse({ date: '2026-10-22', variable: 'topic', note: 'x'.repeat(301) })).toThrow();
  });
});
