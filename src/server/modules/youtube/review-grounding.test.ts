import { describe, expect, it } from 'vitest';
import { validateYoutubeReviewGrounding } from './review-grounding';

const metricMap = {
  median_first28_last10: { value: 1200, unit: 'views', label: 'Median first 28 days' },
  hit_rate_first_low: { value: 0.25, unit: 'fraction', label: 'Low hit rate' },
  'v:video-1:first28_views': { value: 2400, unit: 'views', label: 'Video views' },
  'search:last28d:1:views': { value: 30, unit: 'views', label: 'Search term views' },
} as const;

const channelPacket = {
  target: 'channel',
  matureCount: 12,
  verdict: { verdict: 'continue', reasons: ['Keep testing one variable.'] },
  videos: [{ videoId: 'video-1', title: 'A documentary', searchTerms: [{ window: 'last28d', terms: [{ rank: 1, term: 'history', metricIds: ['search:last28d:1:views'] }] }] }],
  searchTerms: [{ window: 'last28d', terms: [{ rank: 1, term: 'history', metricIds: ['search:last28d:1:views'] }] }],
};

describe('YouTube review grounding', () => {
  it('accepts localized rounded numbers and rejects numbers without cited evidence', () => {
    const good = {
      target: 'channel',
      summary: 'Trung vị là 1,2k lượt xem; tỷ lệ này là 25%.',
      strengths: [{ text: 'Video đạt 2.400 lượt xem.', metricIds: ['v:video-1:first28_views'] }],
      weaknesses: [],
      diagnosis: { classification: 'unclear', reasoning: 'Mẫu 12 video chưa đủ kết luận.', metricIds: ['median_first28_last10'] },
      actionPlan: [], limits: [],
    };
    expect(validateYoutubeReviewGrounding({ target: 'channel', output: good, packet: channelPacket, metricMap, matureCount: 12 }).invalidItems).toEqual([]);
    const bad = structuredClone(good);
    bad.strengths[0]!.text = 'Video đạt 9 nghìn lượt xem.';
    expect(validateYoutubeReviewGrounding({ target: 'channel', output: bad, packet: channelPacket, metricMap, matureCount: 12 }).invalidItems[0]?.reasons.join(' ')).toContain('9 nghìn');
  });

  it('does not absorb sentence punctuation into a localized decimal number', () => {
    const metrics = { ...metricMap, subs_rate: { value: 2.857142857, unit: 'subscribers/1000 views', label: 'Subscribers per 1,000 views' } };
    const output = {
      target: 'channel', summary: 'Tỷ lệ chuyển đổi là 2,86.', strengths: [{ text: 'Chỉ số là 2,86.', metricIds: ['subs_rate'] }], weaknesses: [],
      diagnosis: { classification: 'unclear', reasoning: 'Chưa đủ dữ liệu.', metricIds: [] }, actionPlan: [], limits: [],
    };
    expect(validateYoutubeReviewGrounding({ target: 'channel', output, packet: channelPacket, metricMap: metrics, matureCount: 12 }).invalidItems).toEqual([]);
  });

  it('rejects unknown ids, niche claims below maturity, and forbidden outcome promises', () => {
    const output = {
      target: 'channel', summary: 'Chắc chắn kênh sẽ đạt 10.000 lượt xem.',
      strengths: [{ text: 'Tốt.', metricIds: ['invented_metric'] }], weaknesses: [],
      diagnosis: { classification: 'niche', reasoning: 'Ngách đã rõ.', metricIds: [] }, actionPlan: [], limits: [],
    };
    const result = validateYoutubeReviewGrounding({ target: 'channel', output, packet: channelPacket, metricMap, matureCount: 12 });
    expect(result.invalidItems.map((item) => item.path)).toEqual(expect.arrayContaining(['summary', 'strengths[0]', 'diagnosis']));
    expect((result.output.diagnosis as Record<string, unknown>).classification).toBe('unclear');
  });

  it('preserves stop wording only for the deterministic consider_stop verdict', () => {
    const output = {
      target: 'channel', summary: 'Nên dừng thử nghiệm này.', strengths: [], weaknesses: [],
      diagnosis: { classification: 'unclear', reasoning: 'Chưa rõ.', metricIds: [] }, actionPlan: [], limits: [],
    };
    const rejected = validateYoutubeReviewGrounding({ target: 'channel', output, packet: channelPacket, metricMap, matureCount: 12 });
    expect(rejected.invalidItems.some((item) => item.path === 'summary')).toBe(true);
    const stopPacket = { ...channelPacket, verdict: { verdict: 'consider_stop', reasons: [{ text: 'Sau các thử nghiệm đã định, cân nhắc dừng ngách.' }] } };
    const accepted = validateYoutubeReviewGrounding({ target: 'channel', output: { ...output, summary: 'Sau các thử nghiệm đã định, cân nhắc dừng ngách.' }, packet: stopPacket, metricMap, matureCount: 12 });
    expect(accepted.invalidItems.some((item) => item.path === 'summary')).toBe(false);
  });

  it('checks retention times and mapped scenes against the supplied drops', () => {
    const packet = { ...channelPacket, target: 'video', video: { videoId: 'video-1' }, retention: { mappingQuality: 'exact', drops: [{ fromSec: 45.000000001, toSec: 70, dropPercent: 18, sceneIndexes: [6] }] } };
    const output = { summary: 'Retention falls at 0:45–1:10.', strengths: [], weaknesses: [], retentionFindings: [{ fromSec: 45, toSec: 70, sceneIndexes: [6], observation: 'Người xem giảm 18% ở cảnh 6 (giây 45–70).', suggestion: 'Giữ nguyên một biến.' }], searchFindings: [], nextChange: { variable: 'hook', why: 'Tập trung phần mở đầu.', metricIds: ['v:video-1:first28_views'], successCriterion: { metricId: 'median_first28_last10', comparator: '>=', value: 1200, afterVideos: 5 } }, limits: [] };
    expect(validateYoutubeReviewGrounding({ target: 'video', output, packet, metricMap, matureCount: 12 }).invalidItems).toEqual([]);
    const wrong = structuredClone(output);
    wrong.retentionFindings[0]!.sceneIndexes = [7];
    expect(validateYoutubeReviewGrounding({ target: 'video', output: wrong, packet, metricMap, matureCount: 12 }).invalidItems.some((item) => item.path === 'retentionFindings[0]')).toBe(true);
  });

  it('rejects duplicate idea titles, ungrounded ranks and changes to two variables', () => {
    const output = { ideas: [{ title: 'A documentary', angle: 'Đổi tiêu đề và thumbnail.', basedOn: { metricIds: ['median_first28_last10'], videoIds: ['video-1'], searchTermRanks: [1] }, changedVariable: 'title', hypothesis: 'Có thể giúp cải thiện.', successCriterion: { metricId: 'median_first28_last10', comparator: '>=', value: 1300, afterVideos: 5 }, risk: 'Mẫu nhỏ.' }] };
    const packet = { ...channelPacket, existingVideoTitles: ['A documentary'] };
    const result = validateYoutubeReviewGrounding({ target: 'ideas', output, packet, metricMap, matureCount: 12 });
    expect(result.invalidItems[0]?.reasons.join(' ')).toMatch(/duplicate|variable/iu);
  });

  it('requires checkable criteria and flags time and promise numbers without supporting metrics', () => {
    const output = { target: 'channel', summary: 'Sau 5 video sẽ đạt 10.000 lượt xem.', strengths: [], weaknesses: [], diagnosis: { classification: 'unclear', reasoning: 'Chưa rõ.', metricIds: [] }, actionPlan: [{ step: 'Sau 5 video, median đạt 10.000.', variable: 'title', why: 'Thử tiêu đề.', metricIds: ['median_first28_last10'], successCriterion: { metricId: 'missing', comparator: '>=', value: 10000, afterVideos: 0 } }], limits: [] };
    const result = validateYoutubeReviewGrounding({ target: 'channel', output, packet: channelPacket, metricMap, matureCount: 12 });
    expect(result.invalidItems.map((item) => item.path)).toEqual(expect.arrayContaining(['summary', 'actionPlan[0]']));
  });
});
