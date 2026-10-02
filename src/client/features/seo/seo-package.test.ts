import { describe, expect, it } from 'vitest';
import { emptySeoPackage } from '../../../contracts/seo';
import type { ProjectDetail } from '../../../contracts/project';
import { buildPackageMarkdown, buildPublishChecklist, slugifyPackageTitle } from '../../../contracts/seo-format';

function project(): ProjectDetail {
  return {
    title: 'Điện Biên Phủ: Một thế trận',
    brief: 'Chiến dịch Điện Biên Phủ năm 1954.',
    referencesText: 'Năm 1954.',
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

describe('SEO publish package helpers', () => {
  it('marks every publish requirement done for a complete package', () => {
    const checklist = buildPublishChecklist(project());
    expect(checklist.every((item) => item.done)).toBe(true);
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
      'title', 'description', 'tags', 'hashtag', 'pinnedComment', 'thumbnail', 'video',
    ]);
  });

  it('exports the chosen package content and a Vietnamese-safe filename slug', () => {
    const markdown = buildPackageMarkdown(project());
    expect(markdown).toContain('Điện Biên Phủ năm 1954');
    expect(markdown).toContain('#DienBienPhu');
    expect(markdown).toContain('Bẫy hoàn hảo');
    expect(slugifyPackageTitle('Điện Biên Phủ: Một thế trận!')).toBe('dien-bien-phu-mot-the-tran');
  });
});
