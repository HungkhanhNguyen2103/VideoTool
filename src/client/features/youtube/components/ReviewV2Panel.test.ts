import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('YouTube review panel', () => {
  it('offers rerun from the stale result banner', async () => {
    const source = await readFile(new URL('./ReviewV2Panel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onRerun={() => void runReview()}');
    expect(source).toContain('staleText && <aside');
    expect(source).toContain('Phân tích lại');
  });

  it('keeps project scene links and the current narration excerpt in the video review', async () => {
    const source = await readFile(new URL('./ReviewV2Panel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Trích đoạn lời dẫn');
    expect(source).toContain('?scene=${sceneIndex}');
    expect(source).toContain('YouTube ẩn các từ khóa ít lượt');
  });

  it('routes video citations back through the analytics drawer owner', async () => {
    const source = await readFile(new URL('../YoutubeAnalyticsPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('function VideoDetailDrawer({ channelId, videoId, onClose, onOpenVideo }');
    expect(source).toContain('onOpenVideo={onOpenVideo}');
    expect(source).toContain('<VideoDetailDrawer channelId={channel.id} videoId={selectedVideoId} onClose={() => setSelectedVideoId(null)} onOpenVideo={setSelectedVideoId} />');
  });

  it('reattaches to an existing job returned by the review conflict response', async () => {
    const source = await readFile(new URL('./ReviewV2Panel.tsx', import.meta.url), 'utf8');
    expect(source).toContain("error.code === 'YOUTUBE_REVIEW_ALREADY_RUNNING'");
    expect(source).toContain('setJobId(error.jobId)');
  });
});
