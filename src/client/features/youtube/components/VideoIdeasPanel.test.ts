import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('VideoIdeasPanel product states', () => {
  it('renders evidence tiers, manual demand checks, research handoff, and guarded experiment actions', async () => {
    const source = await readFile(new URL('./VideoIdeasPanel.tsx', import.meta.url), 'utf8');
    const view = await readFile(new URL('../idea-view.ts', import.meta.url), 'utf8');
    expect(source).toContain('Ý tưởng video tiếp theo');
    expect(source).toContain('Cần kiểm chứng');
    expect(source).toContain('Từ trí nhớ của AI, chưa có nguồn');
    expect(source).toContain('Kiểm tra nhu cầu thủ công · khoảng 5 phút');
    expect(source).toContain('Tạo dự án từ ý tưởng');
    expect(source).toContain('Sao chép yêu cầu research');
    expect(source).toContain('window.confirm');
    expect(source).toContain('YOUTUBE_IDEAS_ALREADY_RUNNING');
    expect(source).toContain('Danh sách dự án hoặc video đã đổi');
    expect(view).toContain('Chỉ ghi điều có nguồn; nếu thiếu bằng chứng cho một mắt xích, nói rõ.');
  });

  it('surfaces CLI availability, cancellation, failure, and rejected ideas in separate states', async () => {
    const source = await readFile(new URL('./VideoIdeasPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Claude Code CLI sẵn sàng');
    expect(source).toContain('progress?.status === \'failed\'');
    expect(source).toContain('progress?.status === \'cancelled\'');
    expect(source).toContain('Ý tưởng đã loại bỏ');
    expect(source).toContain('progress?.logs');
    expect(source).toContain('Đang xác định mức chứng cứ');
  });

  it('shows partial-run reasons and retries through the existing generate action', async () => {
    const source = await readFile(new URL('./VideoIdeasPanel.tsx', import.meta.url), 'utf8');
    const view = await readFile(new URL('../idea-view.ts', import.meta.url), 'utf8');
    expect(source).toContain('youtubeIdeaPartialRunNotice');
    expect(source).toContain('Chạy lại để lấy thêm');
    expect(source).toContain('onClick={() => void generate()}');
    expect(view).toContain('ý bị loại vì');
  });
});
