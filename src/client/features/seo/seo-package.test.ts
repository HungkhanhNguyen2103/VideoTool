import { describe, expect, it } from 'vitest';
import { emptySeoPackage } from '../../../contracts/seo';
import type { ProjectDetail } from '../../../contracts/project';
import type { Channel } from '../../../contracts/channel';
import { buildPackageMarkdown, buildPublishChecklist, slugifyPackageTitle } from '../../../contracts/seo-format';

function project(): ProjectDetail {
  return {
    title: 'Điện Biên Phủ: Một thế trận',
    brief: 'Chiến dịch Điện Biên Phủ năm 1954.',
    referencesText: 'Năm 1954.',
    language: 'vi',
    updatedAt: '2026-10-02T00:00:00.000Z',
    renderFileId: 'render-1',
    seo: {
      ...emptySeoPackage(),
      titles: [{ id: 'title-1', text: 'Điện Biên Phủ năm 1954', angle: 'number' }],
      chosenTitleId: 'title-1',
      descriptionIntro: 'Một mô tả ngắn.',
      tags: ['history'],
      hashtags: ['#DienBienPhu'],
      pinnedComment: 'Bạn nghĩ gì?',
      thumbnail: { ideas: [{ id: 'idea-1', overlayText: 'Bẫy hoàn hảo', concept: 'Map', imagePrompt: 'A documentary map' }], chosenIdeaId: 'idea-1', fileId: 'thumb-1' },
    },
    chapters: [],
    scenes: [],
    renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: 24 },
  } as unknown as ProjectDetail;
}

const channel: Channel = {
  id: 'channel-1', name: 'Kênh Sử Việt', handle: '@su-viet', tagline: '', description: '', language: 'vi', links: [], defaultHashtags: [],
  descriptionFooter: '', publishSchedule: null, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
};

describe('SEO publish package helpers', () => {
  it('keeps the AI-content item as a neutral reminder on an otherwise complete package', () => {
    const value = { ...project(), channelId: channel.id, referencesText: '[1] Source: https://example.org/source' };
    const checklist = buildPublishChecklist(value, undefined, channel);
    const reminder = checklist.find((item) => item.key === 'ai-content');
    expect(checklist.filter((item) => item.key !== 'ai-content').every((item) => item.done)).toBe(true);
    expect(reminder).toMatchObject({ done: false, reminder: true, label: 'Khai báo nội dung AI/tổng hợp' });
    expect(reminder?.warning).toBeUndefined();
  });

  it('reports each missing publish requirement without blocking edits', () => {
    const value = project();
    value.seo.chosenTitleId = null;
    value.seo.descriptionIntro = '';
    value.seo.tags = [];
    value.seo.hashtags = [];
    value.seo.pinnedComment = '';
    value.seo.thumbnail.fileId = null;
    value.renderFileId = null;
    expect(buildPublishChecklist(value).filter((item) => !item.done).map((item) => item.key)).toEqual([
      'title', 'description', 'tags', 'hashtag', 'pinnedComment', 'thumbnail', 'video', 'channel', 'sources', 'ai-content',
    ]);
  });

  it('does not mark description complete when only chapters and hashtags are assembled', () => {
    const value = project();
    value.seo.descriptionIntro = '';
    value.seo.descriptionKeywords = '';
    value.seo.hashtags = ['#DienBienPhu'];
    value.scenes = [1, 2, 3].map((number) => ({
      id: `scene-${number}`,
      narration: `Scene ${number}`,
      visualPrompt: '',
      durationSec: 10,
      active: true,
    })) as unknown as ProjectDetail['scenes'];
    value.chapters = [1, 2, 3].map((number) => ({
      id: `chapter-${number}`,
      no: number,
      title: `Chapter ${number}`,
      paragraphs: [`Scene ${number}`],
      status: 'approved',
      scenesCount: 1,
      durationSec: 10,
    })) as unknown as ProjectDetail['chapters'];

    const description = buildPublishChecklist(value).find((item) => item.key === 'description');

    expect(description).toMatchObject({ done: false, detail: 'Chưa có phần mở đầu mô tả.' });
  });

  it('exports the chosen package content and a Vietnamese-safe filename slug', () => {
    const markdown = buildPackageMarkdown(project());
    expect(markdown).toContain('Điện Biên Phủ năm 1954');
    expect(markdown).toContain('#DienBienPhu');
    expect(markdown).toContain('Bẫy hoàn hảo');
    expect(slugifyPackageTitle('Điện Biên Phủ: Một thế trận!')).toBe('dien-bien-phu-mot-the-tran');
  });

  it('exports the assigned channel and channel-aware assembled description', () => {
    const value = { ...project(), channelId: channel.id, referencesText: '[1] Source: https://example.org/source' };
    const assigned = { ...channel, links: [{ label: 'Trang chủ', url: 'https://example.org/channel' }], descriptionFooter: 'Theo dõi kênh.' };
    const markdown = buildPackageMarkdown(value, assigned);
    expect(markdown).toContain('## Kênh\nKênh Sử Việt');
    expect(markdown).toContain('@');
    expect(markdown).toContain('Trang chủ: https://example.org/channel');
    expect(markdown).toContain('Nguồn tham khảo:\n1. Source: https://example.org/source');
    expect(markdown).toContain('Theo dõi kênh.');
  });

  it('warns when sources have no numbered HTTP URL or description blocks were trimmed', () => {
    const value = project();
    const checklist = buildPublishChecklist(value);
    expect(checklist.find((item) => item.key === 'sources')).toMatchObject({ done: false, warning: true });

    value.seo.descriptionIntro = 'i'.repeat(5000);
    value.seo.descriptionKeywords = 'optional keywords';
    value.seo.hashtags = ['#Tag'];
    const descriptionLength = buildPublishChecklist(value).find((item) => item.key === 'description-length');
    expect(descriptionLength).toMatchObject({ done: false, warning: true });
    expect(descriptionLength?.detail).toContain('vượt giới hạn');
  });

  it('keeps all-inactive chapter timestamps warn-only and omits them from the package', () => {
    const value = project();
    value.scenes = [1, 2, 3, 4].map((number) => ({
      id: `scene-${number}`, narration: `Scene ${number}`, visualPrompt: '', durationSec: 10, active: number !== 2,
    })) as unknown as ProjectDetail['scenes'];
    value.chapters = [1, 2, 3, 4].map((number) => ({
      id: `chapter-${number}`, no: number, title: `Chapter ${number}`, paragraphs: [`Scene ${number}`], status: 'approved', scenesCount: 1, durationSec: 10,
    })) as unknown as ProjectDetail['chapters'];

    const checklist = buildPublishChecklist(value);
    const timelineNote = checklist.find((item) => item.key === 'chapter-timestamps');
    const markdown = buildPackageMarkdown(value);

    expect(timelineNote).toMatchObject({ done: true, warning: true, detail: expect.stringContaining('Chapter 2') });
    expect(markdown).toContain('0:10 Chapter 3');
    expect(markdown).not.toContain('Chapter 2');
  });
});
