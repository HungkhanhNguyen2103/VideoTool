import { describe, expect, it } from 'vitest';
import {
  YoutubeChannelReviewV2AnalysisSchema,
  YoutubeReviewRequestSchema,
} from './youtube-review';

describe('YouTube review v2 contracts', () => {
  it('rejects extra request fields and malformed success criteria', () => {
    expect(YoutubeReviewRequestSchema.parse({ backend: 'cli', cliModel: 'claude-sonnet-4-5' })).toEqual({ backend: 'cli', cliModel: 'claude-sonnet-4-5' });
    expect(() => YoutubeReviewRequestSchema.parse({ backend: 'cli', token: 'secret' })).toThrow();
    expect(() => YoutubeChannelReviewV2AnalysisSchema.parse({
      summary: 'Summary',
      strengths: [], weaknesses: [],
      diagnosis: { classification: 'unclear', reasoning: 'Too little evidence.', metricIds: [] },
      actionPlan: [{
        step: 'Test one variable.', variable: 'title', why: 'Measure the change.', metricIds: ['median_first28_last10'],
        successCriterion: { metricId: 'median_first28_last10', comparator: '==', value: 120, afterVideos: 0 },
      }],
      limits: [],
    })).toThrow();
  });
});
