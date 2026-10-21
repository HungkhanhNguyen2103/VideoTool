import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptySeoPackage } from '../../../../contracts/seo';
import type { ProjectDetail } from '../../../../contracts/project';
import type { Channel } from '../../../../contracts/channel';
import { PublishPanel } from './PublishPanel';

describe('PublishPanel reminder rendering', () => {
  it('shows the AI-content item with a neutral reminder style and no warning state', () => {
    const project = {
      id: 'project-1', title: 'History', brief: '', referencesText: '', language: 'en', channelId: null,
      updatedAt: '2026-10-21T00:00:00.000Z', renderFileId: null, seo: emptySeoPackage(), chapters: [], scenes: [],
      renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: 24 },
    } as unknown as ProjectDetail;
    const html = renderToStaticMarkup(<PublishPanel project={project} onCopy={() => undefined} onDownload={() => undefined} />);
    const reminderIndex = html.indexOf('Khai báo nội dung AI/tổng hợp');
    const reminderRow = html.slice(html.lastIndexOf('<li', reminderIndex), html.indexOf('</li>', reminderIndex) + 5);

    expect(reminderRow).toBeDefined();
    expect(reminderRow).not.toContain('checkWarning');
    expect(reminderRow).toContain('YouTube');
    expect(html).toContain('Kênh chưa có lịch đăng; đặt lịch trong Quản lý kênh nếu muốn.');
    expect(html).toContain('không công khai');
    expect(html).toContain('2–4 giờ');
  });

  it('shows three deterministic long-video slots with a neutral schedule reminder', () => {
    const channel: Channel = {
      id: 'channel-1', name: 'History', language: 'vi', tagline: '', description: '', links: [], defaultHashtags: [], descriptionFooter: '',
      publishSchedule: { timezone: 'Asia/Ho_Chi_Minh', slots: [
        { weekday: 2, time: '20:00', kind: 'long' },
        { weekday: 5, time: '20:00', kind: 'long' },
        { weekday: 0, time: '20:00', kind: 'long' },
      ], notes: '' },
      createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    };
    const project = {
      id: 'project-1', title: 'History', brief: '', referencesText: '', language: 'en', channelId: channel.id,
      updatedAt: '2026-10-21T00:00:00.000Z', renderFileId: null, seo: emptySeoPackage(), chapters: [], scenes: [],
      renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: 24 },
    } as unknown as ProjectDetail;
    const html = renderToStaticMarkup(<PublishPanel project={project} channel={channel} now={new Date('2026-10-18T16:00:00.000Z')} onCopy={() => undefined} onDownload={() => undefined} />);

    expect(html.match(/Sao chép giờ/g)).toHaveLength(3);
    expect(html).toContain('Thứ Ba 20/10/2026 20:00 (Asia/Ho_Chi_Minh)');
    expect(html).toContain('hãy chỉnh theo số liệu YouTube Studio của kênh');
    const scheduleRow = html.match(/<li class="[^"]*checkReminder[^"]*">[^]*?Lịch đăng gợi ý[^]*?<\/li>/)?.[0];
    expect(scheduleRow).toBeDefined();
    expect(scheduleRow).not.toContain('checkWarning');
  });
});
