import { describe, expect, it } from 'vitest';
import { runYoutubeReviewV2Analysis, YOUTUBE_REVIEW_IDEAS_MIN_MATURE, type YoutubeReviewEvidencePacket, type YoutubeReviewJobContext } from './review-v2-engine';
import { NEXT_VIDEO_IDEAS_MIN_MATURE } from '../../../contracts/youtube-ideas';

function packet(matureCount: number): YoutubeReviewEvidencePacket {
  const data = {
    packet: { target: 'channel', matureCount, verdict: { verdict: 'continue', reasons: [] }, videos: [{ videoId: 'video-1', title: 'Existing Documentary' }], searchTerms: [] },
    metricMap: { median_first28_last10: { value: 1200, unit: 'views', label: 'Median first-28 views' } },
    fingerprint: 'a'.repeat(64),
    packetSummary: { matureCount, includedVideoCount: 1, truncatedVideoCount: 0 },
  };
  return { ...data, serialized: JSON.stringify({ ...data.packet, metrics: data.metricMap }) };
}

function context(cancel = false): YoutubeReviewJobContext & { logs: string[]; progress: number[] } {
  const logs: string[] = []; const progress: number[] = [];
  return { logs, progress, isCancelled: async () => cancel, appendLog: async (message) => { logs.push(message); }, reportProgress: async (value) => { progress.push(value); } };
}

const channelJson = (strengths: unknown[] = []) => JSON.stringify({
  summary: 'Trung vị 1.200 lượt xem cho thấy mức khởi điểm còn khiêm tốn.',
  strengths,
  weaknesses: [],
  diagnosis: { classification: 'unclear', reasoning: 'Chưa đủ bằng chứng phân biệt ngách và cách thực hiện.', metricIds: ['median_first28_last10'] },
  actionPlan: [], limits: [],
});

const ideasJson = JSON.stringify({ ideas: [{
  title: 'A New Historical Question', angle: 'Chủ đề mới mở ra một câu hỏi cụ thể.',
  basedOn: { metricIds: ['median_first28_last10'], videoIds: ['video-1'] }, changedVariable: 'topic',
  hypothesis: 'Một câu hỏi hẹp có thể phù hợp hơn với khán giả.',
  successCriterion: { metricId: 'median_first28_last10', comparator: '>=', value: 1300, afterVideos: 5 }, risk: 'Một video đơn lẻ có thể không đại diện.',
}] });

describe('YouTube review v2 job engine', () => {
  it('shares the evidence gate with the standalone video-ideas feature', () => {
    expect(YOUTUBE_REVIEW_IDEAS_MIN_MATURE).toBe(NEXT_VIDEO_IDEAS_MIN_MATURE);
  });

  it('gates ideas at nine mature videos without making an ideas call', async () => {
    const calls: string[] = []; const ctx = context();
    const result = await runYoutubeReviewV2Analysis({ target: 'channel', packet: packet(9), backend: { kind: 'api', model: 'test-model', chat: async (messages) => { calls.push(messages[1]!.content); return channelJson(); } }, context: ctx });
    expect(calls).toHaveLength(1);
    expect(result?.ideas).toEqual({ status: 'gated', reason: 'Cần ít nhất 10 video đã đủ 28 ngày; hiện có 9.', items: [] });
  });

  it('calls the next-video ideas step at ten mature videos in sequence', async () => {
    const calls: string[] = []; const ctx = context();
    const result = await runYoutubeReviewV2Analysis({ target: 'channel', packet: packet(10), backend: { kind: 'api', model: 'test-model', chat: async (messages) => { calls.push(messages[1]!.content); return calls.length === 1 ? channelJson() : ideasJson; } }, context: ctx });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('Analyze the channel evidence');
    expect(calls[1]).toContain('next-video ideas');
    expect(result?.ideas).toMatchObject({ status: 'generated', items: [{ changedVariable: 'topic' }] });
  });

  it('uses tolerant JSON extraction and sends exactly one grounding repair for invalid items', async () => {
    let calls = 0; const ctx = context();
    const result = await runYoutubeReviewV2Analysis({ target: 'channel', packet: packet(9), backend: { kind: 'cli', model: 'claude-test', chat: async () => {
      calls += 1;
      if (calls === 1) return `Here is the result:\n\`\`\`json\n${channelJson([{ text: 'Tốt', metricIds: ['unknown'] }])}\n\`\`\``;
      return channelJson([{ text: 'Trung vị là 1.200 lượt xem.', metricIds: ['median_first28_last10'] }]);
    } }, context: ctx });
    expect(calls).toBe(2);
    expect(result?.analysis.strengths).toHaveLength(1);
    expect(result?.groundingReport.repaired).toBe(1);
    expect(ctx.logs.some((line) => line.includes('một yêu cầu sửa'))).toBe(true);
  });

  it('fails with YOUTUBE_REVIEW_UNGROUNDED when more than half of an output array remains invalid', async () => {
    let calls = 0;
    const invalid = channelJson([{ text: '999 lượt xem.', metricIds: ['median_first28_last10'] }, { text: '888 lượt xem.', metricIds: ['median_first28_last10'] }]);
    await expect(runYoutubeReviewV2Analysis({ target: 'channel', packet: packet(9), backend: { kind: 'api', model: 'api-test', chat: async () => { calls += 1; return invalid; } }, context: context() })).rejects.toMatchObject({ code: 'YOUTUBE_REVIEW_UNGROUNDED' });
    expect(calls).toBe(2);
  });

  it('returns without analysis or another AI call when cancelled before a step', async () => {
    let calls = 0;
    const result = await runYoutubeReviewV2Analysis({ target: 'channel', packet: packet(10), backend: { kind: 'cli', model: 'claude-test', chat: async () => { calls += 1; return channelJson(); } }, context: context(true) });
    expect(result).toBeUndefined();
    expect(calls).toBe(0);
  });
});
