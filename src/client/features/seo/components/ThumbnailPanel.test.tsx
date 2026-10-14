import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptySeoPackage } from '../../../../contracts/seo';
import { ThumbnailPanel, copyThumbnailPrompt } from './ThumbnailPanel';

describe('ThumbnailPanel copy prompt', () => {
  it('renders one copy button per thumbnail idea outside the selectable card', () => {
    const seo = {
      ...emptySeoPackage(),
      thumbnail: {
        ...emptySeoPackage().thumbnail,
        ideas: [
          { id: 'a', overlayText: 'BỊ KHÓA HAI ĐẦU', concept: 'Một', imagePrompt: 'Night river scene' },
          { id: 'b', overlayText: 'KHÔNG LỐI THOÁT', concept: 'Hai', imagePrompt: 'Top-down map' },
        ],
      },
    };
    const html = renderToStaticMarkup(<ThumbnailPanel seo={seo} busy={false} onPatch={() => undefined} onRegenerate={() => undefined} onUpload={() => undefined} onRemove={() => undefined} />);
    expect(html.match(/Sao chép prompt cho Flow/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*class="[^"]*idea[^"]*"[^>]*>(?:(?!<\/button>).)*<button/s);
  });

  it('copies the trimmed image prompt and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    await expect(copyThumbnailPrompt('  Night river scene  ', writeText, notify)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('Night river scene');
    expect(notify).toHaveBeenCalledWith('Đã sao chép prompt ảnh. Dán vào Flow để tạo thumbnail.');
  });

  it('reports an empty prompt without touching the clipboard', async () => {
    const writeText = vi.fn();
    const notify = vi.fn();
    await expect(copyThumbnailPrompt('   ', writeText, notify)).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Ý tưởng này chưa có prompt ảnh.');
  });

  it('reports a clipboard failure instead of throwing', async () => {
    const notify = vi.fn();
    await expect(copyThumbnailPrompt('x', vi.fn().mockRejectedValue(new Error('denied')), notify)).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith('Không thể sao chép prompt. Hãy bôi đen và sao chép thủ công.');
  });
});
