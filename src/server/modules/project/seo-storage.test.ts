import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SeoPackage } from '../../../contracts/seo';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { getCollection } from '../../db/client';
import {
  applyGeneratedSeoSections,
  createProject,
  duplicateProject,
  getProject,
  patchProjectSeo,
} from './service';
import type { ProjectDoc } from './docs';

const projectInput = {
  title: 'SEO storage project',
  brief: 'A sufficiently long brief for SEO storage tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1280, height: 720, fps: 24 as const },
};

const generatedBy = { provider: 'manual' as const, model: 'manual', promptVersion: 'seo-v1', generatedAt: '2026-10-02T00:00:00.000Z' };

const title = { id: 'title-1', text: 'Điện Biên Phủ: Bẫy Sập Của Kẻ Đi Săn', angle: 'curiosity' as const };
const idea = { id: 'idea-1', overlayText: 'Bẫy Sập', concept: 'A dark mountain pass', imagePrompt: 'A cinematic historical mountain pass' };

function packageWithContent(): SeoPackage {
  return {
    titles: [title],
    chosenTitleId: title.id,
    descriptionIntro: 'Một mô tả ngắn.',
    descriptionKeywords: 'Điện Biên Phủ, chiến dịch năm 1954.',
    tags: ['lịch sử chiến dịch', 'quân sự'],
    hashtags: ['#DienBienPhu'],
    pinnedComment: 'Bạn nghĩ gì về chiến lược này?',
    thumbnail: { ideas: [idea], chosenIdeaId: idea.id, fileId: 'thumbnail-1' },
    generatedBy,
  };
}

beforeAll(startTestMongo);
beforeEach(async () => {
  await resetTestMongo();
  await getCollection<ProjectDoc>('projects').deleteMany({});
});
afterAll(closeTestMongo);

describe('SEO project storage', () => {
  it('defaults legacy project documents to an empty SEO package', async () => {
    const project = await createProject(projectInput);
    const result = await getCollection<ProjectDoc>('projects').updateOne({ _id: project.id }, { $unset: { seo: '' } });

    expect(result.modifiedCount).toBe(1);
    expect((await getProject(project.id)).seo).toEqual({
      titles: [],
      chosenTitleId: null,
      descriptionIntro: '',
      descriptionKeywords: '',
      tags: [],
      hashtags: [],
      pinnedComment: '',
      thumbnail: { ideas: [], chosenIdeaId: null, fileId: null },
      generatedBy: null,
    });
  });

  it('duplicates SEO text but clears the thumbnail file reference', async () => {
    const project = await createProject(projectInput);
    await patchProjectSeo(project.id, packageWithContent());

    const duplicate = await duplicateProject(project.id);

    expect(duplicate.seo.titles).toEqual([title]);
    expect(duplicate.seo.chosenTitleId).toBe(title.id);
    expect(duplicate.seo.thumbnail.ideas).toEqual([idea]);
    expect(duplicate.seo.thumbnail.chosenIdeaId).toBe(idea.id);
    expect(duplicate.seo.thumbnail.fileId).toBeNull();
  });

  it('patches only the requested top-level fields and increments version once', async () => {
    const project = await createProject(projectInput);
    await patchProjectSeo(project.id, packageWithContent());
    const before = await getProject(project.id);

    const after = await patchProjectSeo(project.id, { descriptionIntro: 'Mô tả đã sửa.' });

    expect(after.version).toBe(before.version + 1);
    expect(after.seo.descriptionIntro).toBe('Mô tả đã sửa.');
    expect(after.seo.titles).toEqual(before.seo.titles);
    expect(after.seo.thumbnail).toEqual(before.seo.thumbnail);
  });

  it('applies selected generated sections without overwriting other sections', async () => {
    const project = await createProject(projectInput);
    await patchProjectSeo(project.id, packageWithContent());
    const before = await getProject(project.id);
    const nextTitle = { ...title, id: 'title-2', text: 'Một tiêu đề mới', angle: 'number' as const };

    const after = await applyGeneratedSeoSections(project.id, ['titles', 'thumbnail'], {
      titles: [nextTitle],
      thumbnail: { ideas: [{ ...idea, id: 'idea-2' }], chosenIdeaId: 'missing', fileId: null },
      generatedBy,
    });

    expect(after.version).toBe(before.version + 1);
    expect(after.seo.titles).toEqual([nextTitle]);
    expect(after.seo.chosenTitleId).toBeNull();
    expect(after.seo.thumbnail.ideas[0]?.id).toBe('idea-2');
    expect(after.seo.thumbnail.chosenIdeaId).toBeNull();
    expect(after.seo.thumbnail.fileId).toBe('thumbnail-1');
    expect(after.seo.descriptionIntro).toBe(before.seo.descriptionIntro);
    expect(after.seo.tags).toEqual(before.seo.tags);
    expect(after.seo.generatedBy).toEqual(generatedBy);
  });

  it('writes description keywords together with the generated description section', async () => {
    const project = await createProject(projectInput);
    const after = await applyGeneratedSeoSections(project.id, ['description'], {
      descriptionIntro: 'Mở đầu mới.',
      descriptionKeywords: 'Sự kiện, nhân vật, địa danh và thời kỳ.',
      generatedBy,
    });

    expect(after.seo.descriptionIntro).toBe('Mở đầu mới.');
    expect(after.seo.descriptionKeywords).toBe('Sự kiện, nhân vật, địa danh và thời kỳ.');
  });

  it('preserves existing description keywords when generated output omits them', async () => {
    const project = await createProject(projectInput);
    await patchProjectSeo(project.id, { descriptionIntro: 'Existing intro.', descriptionKeywords: 'User-edited keywords.' });

    const after = await applyGeneratedSeoSections(project.id, ['description'], {
      descriptionIntro: 'Generated intro.',
      generatedBy,
    });

    expect(after.seo.descriptionIntro).toBe('Generated intro.');
    expect(after.seo.descriptionKeywords).toBe('User-edited keywords.');
  });

  it('clears existing description keywords when generated output supplies an empty string', async () => {
    const project = await createProject(projectInput);
    await patchProjectSeo(project.id, { descriptionIntro: 'Existing intro.', descriptionKeywords: 'User-edited keywords.' });

    const after = await applyGeneratedSeoSections(project.id, ['description'], {
      descriptionIntro: 'Generated intro.',
      descriptionKeywords: '',
      generatedBy,
    });

    expect(after.seo.descriptionKeywords).toBe('');
  });

  it('rejects unknown fields in an SEO patch', async () => {
    const project = await createProject(projectInput);

    await expect(patchProjectSeo(project.id, { unknown: 'nope' } as never)).rejects.toThrow();
  });
});
