import { describe, expect, it } from 'vitest';
import { buildYoutubeReviewPrompt, parseYoutubeReview, requestYoutubeReview } from './ai-review';

describe('YouTube AI review parser and prompt', () => {
  it('accepts strict JSON with observations, hypotheses, and at most five experiments', () => {
    expect(parseYoutubeReview('{"observations":["views/day rose"],"hypotheses":["intro length may matter"],"experiments":["Test a shorter opening"]}')).toMatchObject({ experiments: ['Test a shorter opening'] });
    expect(() => parseYoutubeReview('{"observations":[],"hypotheses":[],"experiments":["1","2","3","4","5","6"]}')).toThrow();
    expect(() => parseYoutubeReview('not json')).toThrow();
  });

  it('uses a versioned Vietnamese prompt and serializes only the approved metric snapshot', () => {
    const prompt = buildYoutubeReviewPrompt({ kind: 'video', window: '28d', title: 'Kênh của Hung', metrics: { views: 250, averageViewPercentage: 42 }, sampleSize: 1 });
    expect(prompt.promptVersion).toBe('youtube-review-v1');
    expect(prompt.system).toContain('Vietnamese');
    expect(prompt.system.toLowerCase()).toContain('never promise or predict views or revenue');
    expect(prompt.serializedInput).toBe('{"kind":"video","window":"28d","title":"Kênh của Hung","metrics":{"views":250,"averageViewPercentage":42},"sampleSize":1}');
    expect(prompt.serializedInput).not.toMatch(/token|rawPayload|private/i);
  });

  it('retries once through the validation-error path and accepts the corrected response', async () => {
    const messages: string[] = [];
    let calls = 0;
    const result = await requestYoutubeReview({ kind: 'channel', window: '28d', metrics: { views: 250 }, sampleSize: 1 }, {
      chat: async (items) => {
        calls += 1;
        messages.push(items.map((item) => item.content).join('\n'));
        return calls === 1 ? 'not json' : '{"observations":["250 views in the supplied window"],"hypotheses":[],"experiments":[]}';
      },
    });
    expect(calls).toBe(2);
    expect(messages[1]).toContain('Validation error:');
    expect(result.promptVersion).toBe('youtube-review-v1');
  });
});
