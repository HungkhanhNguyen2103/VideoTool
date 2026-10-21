import { describe, expect, it } from 'vitest';
import { emptySeoPackage } from '../../../contracts/seo';
import type { ProjectDetail } from '../../../contracts/project';
import type { Channel } from '../../../contracts/channel';
import { pickShortsWindows } from '../../../contracts/seo-shorts';
import { buildPackageMarkdown, buildPublishChecklist, slugifyPackageTitle, substituteLongVideoUrl } from '../../../contracts/seo-format';

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

function projectWithShorts() {
  const value = project();
  value.scenes = [1, 2, 3].map((number) => ({ id: `scene-${number}`, narration: `Narration ${number}`, visualPrompt: '', durationSec: 10, active: true })) as unknown as ProjectDetail['scenes'];
  value.chapters = [{ id: 'chapter-1', no: 1, title: 'Mở đầu', paragraphs: [], status: 'approved', scenesCount: 3, durationSec: 30, role: 'climax' }] as unknown as ProjectDetail['chapters'];
  const window = pickShortsWindows(value).windows[0]!;
  value.seo.shorts = [{
    ...window,
    hookLine: 'Mốc quyết định bắt đầu ở đây.',
    title: 'Một quyết định thay đổi tất cả',
    caption: 'Xem bản đầy đủ: {LONG_VIDEO_URL}',
    hashtags: ['#Shorts', '#LichSu'],
    reason: 'Đoạn này mở ra bước ngoặt.',
  }];
  return value;
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
    const schedule = checklist.find((item) => item.key === 'schedule');
    expect(checklist.filter((item) => item.key !== 'ai-content' && item.key !== 'schedule').every((item) => item.done)).toBe(true);
    expect(reminder).toMatchObject({ done: false, reminder: true, label: 'Khai báo nội dung AI/tổng hợp' });
    expect(reminder?.warning).toBeUndefined();
    expect(schedule).toMatchObject({ done: false, reminder: true });
    expect(schedule?.warning).toBeUndefined();
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
      'title', 'description', 'tags', 'hashtag', 'pinnedComment', 'thumbnail', 'video', 'channel', 'schedule', 'sources', 'ai-content',
    ]);
  });

  it('shows the nearest long-video schedule as a neutral reminder', () => {
    const value = { ...project(), channelId: channel.id };
    const scheduled = {
      ...channel,
      publishSchedule: {
        timezone: 'Asia/Ho_Chi_Minh',
        slots: [{ weekday: 2, time: '20:00', kind: 'long' as const }],
        notes: '',
      },
    };

    const schedule = buildPublishChecklist(value, undefined, scheduled, { now: new Date('2026-10-20T12:00:00.000Z') })
      .find((item) => item.key === 'schedule');

    expect(schedule).toMatchObject({ done: false, reminder: true, detail: 'Slot gần nhất: Thứ Ba 20/10/2026 20:00 (Asia/Ho_Chi_Minh).' });
    expect(schedule?.warning).toBeUndefined();
  });

  it('warns about a chosen title that overlaps another chosen title on the same channel', () => {
    const value = { ...project(), channelId: channel.id };
    const duplicate = buildPublishChecklist(value, undefined, channel, {
      otherChannelTitles: ['Điện Biên Phủ năm 1954: câu chuyện phía sau'],
    }).find((item) => item.key === 'duplicate-title');

    expect(duplicate).toMatchObject({ done: false, warning: true });
    expect(duplicate?.detail).toContain('Điện Biên Phủ năm 1954: câu chuyện phía sau');
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
    expect(markdown).not.toContain('Lịch đăng gợi ý');
    expect(markdown).not.toContain('## Gói Shorts');
    expect(slugifyPackageTitle('Điện Biên Phủ: Một thế trận!')).toBe('dien-bien-phu-mot-the-tran');
  });

  it('exports a Shorts block with substituted caption and a manual-cut note', () => {
    const value = projectWithShorts();
    value.seo.longVideoUrl = 'https://example.org/full-video';
    const markdown = buildPackageMarkdown(value);
    expect(markdown).toContain('## Gói Shorts');
    expect(markdown).toContain('0:00–0:30 · Chương 1');
    expect(markdown).toContain('Hook: Mốc quyết định bắt đầu ở đây.');
    expect(markdown).toContain('Tiêu đề: Một quyết định thay đổi tất cả');
    expect(markdown).toContain('Xem bản đầy đủ: https://example.org/full-video');
    expect(markdown).toContain('Hashtags: #Shorts #LichSu');
    expect(markdown).toContain('Lý do: Đoạn này mở ra bước ngoặt.');
    expect(markdown).toContain('Cắt và dựng video dọc thực hiện thủ công.');
    expect(markdown).not.toContain('{LONG_VIDEO_URL}');
  });

  it('marks Shorts as an optional reminder, a no-window completion, and warns for unresolved or stale content', () => {
    const noWindows = buildPublishChecklist(project()).find((item) => item.key === 'shorts');
    expect(noWindows).toMatchObject({ done: true, detail: 'Video không có đoạn 30–55 giây phù hợp.' });

    const eligible = projectWithShorts();
    eligible.seo.shorts = [];
    const reminder = buildPublishChecklist(eligible).find((item) => item.key === 'shorts');
    expect(reminder).toMatchObject({ done: false, reminder: true });
    expect(reminder?.warning).toBeUndefined();

    eligible.seo.shorts = [{ ...projectWithShorts().seo.shorts[0]!, caption: 'Xem thêm {LONG_VIDEO_URL}' }];
    eligible.seo.longVideoUrl = 'https://example.org/full';
    const complete = buildPublishChecklist(eligible).find((item) => item.key === 'shorts');
    expect(complete).toMatchObject({ done: true, detail: 'Gói Shorts đã có nội dung cho các mốc cắt hiện tại.' });
    expect(complete?.warning).toBeUndefined();

    eligible.seo.longVideoUrl = '';
    const unresolved = buildPublishChecklist(eligible).find((item) => item.key === 'shorts');
    expect(unresolved).toMatchObject({ done: true, warning: true });
    expect(unresolved?.detail).toContain('{LONG_VIDEO_URL}');

    eligible.seo.longVideoUrl = 'https://example.org/video';
    eligible.seo.shorts = [{ ...eligible.seo.shorts[0]!, id: 'short-old' }];
    const stale = buildPublishChecklist(eligible).find((item) => item.key === 'shorts');
    expect(stale).toMatchObject({ done: true, warning: true });
    expect(stale?.detail).toContain('Mốc cắt có thể đã cũ');
  });

  it('substitutes all long-video placeholders only when a URL is supplied', () => {
    const text = 'Watch {LONG_VIDEO_URL} and share {LONG_VIDEO_URL}';
    expect(substituteLongVideoUrl(text, 'https://example.org/full')).toBe('Watch https://example.org/full and share https://example.org/full');
    expect(substituteLongVideoUrl(text, '')).toBe(text);
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

  it('exports the next three suggested long-video slots with timezone and hint-only lead time', () => {
    const value = { ...project(), channelId: channel.id };
    const scheduled = { ...channel, publishSchedule: {
      timezone: 'Asia/Ho_Chi_Minh',
      slots: [
        { weekday: 2, time: '20:00', kind: 'long' as const },
        { weekday: 5, time: '20:00', kind: 'long' as const },
        { weekday: 0, time: '20:00', kind: 'long' as const },
      ],
      notes: '',
    } };
    const markdown = buildPackageMarkdown(value, scheduled, { now: new Date('2026-10-18T16:00:00.000Z') });

    expect(markdown).toContain('## Lịch đăng gợi ý\nMúi giờ: Asia/Ho_Chi_Minh');
    expect(markdown).toContain('1. Thứ Ba 20/10/2026 20:00');
    expect(markdown).toContain('2. Thứ Sáu 23/10/2026 20:00');
    expect(markdown).toContain('3. Chủ nhật 25/10/2026 20:00');
    expect(markdown).toContain('2–4 giờ');
    expect(markdown).toContain('gợi ý, chưa kiểm chứng');
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
