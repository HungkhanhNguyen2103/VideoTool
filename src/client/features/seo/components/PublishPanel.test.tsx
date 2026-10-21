import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptySeoPackage } from '../../../../contracts/seo';
import type { ProjectDetail } from '../../../../contracts/project';
import { PublishPanel } from './PublishPanel';

describe('PublishPanel reminder rendering', () => {
  it('shows the AI-content item with a neutral reminder style and no warning state', () => {
    const project = {
      id: 'project-1', title: 'History', brief: '', referencesText: '', language: 'en', channelId: null,
      updatedAt: '2026-10-21T00:00:00.000Z', renderFileId: null, seo: emptySeoPackage(), chapters: [], scenes: [],
      renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: 24 },
    } as unknown as ProjectDetail;
    const html = renderToStaticMarkup(<PublishPanel project={project} onCopy={() => undefined} onDownload={() => undefined} />);
    const reminderRow = html.match(/<li class="[^"]*checkReminder[^"]*">[^]*?Khai báo nội dung AI\/tổng hợp[^]*?<\/li>/)?.[0];

    expect(reminderRow).toBeDefined();
    expect(reminderRow).not.toContain('checkWarning');
    expect(reminderRow).toContain('YouTube');
  });
});
