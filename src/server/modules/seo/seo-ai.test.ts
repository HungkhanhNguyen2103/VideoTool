import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDetailSchema } from '../../../contracts/project';
import { SEO_SECTIONS } from '../../../contracts/seo';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  getAiClient: vi.fn(),
  getProject: vi.fn(),
  applyGeneratedSeoSections: vi.fn(),
}));

vi.mock('../../shared/ai', () => ({ getAiClient: mocks.getAiClient }));
vi.mock('../project', () => ({
  getProject: mocks.getProject,
  applyGeneratedSeoSections: mocks.applyGeneratedSeoSections,
}));

import { buildSeoPrompt } from './ai/build-prompt';
import { parseSeoOutput, SeoAiOutputError } from './ai/parse-output';
import { generateSeoPackage } from './service';

const project = ProjectDetailSchema.parse({
  id: 'project-1',
  title: 'Điện Biên Phủ',
  status: 'assets',
  language: 'vi',
  brief: 'Một brief đủ dài để kiểm tra prompt SEO.',
  referencesText: 'Nguồn tham khảo về chiến dịch.',
  scriptPresetId: 'documentary',
  targetDurationSec: 60,
  chapterCount: 3,
  voiceId: null,
  renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: 24 },
  scenes: [{ id: 'scene-1', narration: 'Mở đầu dài của chương một.', visualPrompt: '', durationSec: 10, assetType: 'image', assetFileId: 'asset-1' }],
  chapters: [
    { id: 'chapter-1', no: 1, title: 'Mở đầu', paragraphs: ['Mở đầu dài của chương một.'], status: 'approved', scenesCount: 1, durationSec: 10 },
    { id: 'chapter-2', no: 2, title: 'Bước ngoặt', paragraphs: ['Toàn bộ narration không nên đưa vào prompt SEO.'], status: 'approved', scenesCount: 0, durationSec: 0 },
    { id: 'chapter-3', no: 3, title: 'Kết luận', paragraphs: ['Kết luận.'], status: 'approved', scenesCount: 0, durationSec: 0 },
  ],
  aiProvider: 'deepseek',
  aiModel: 'deepseek-flash',
  coreQuestion: 'Vì sao kế hoạch thất bại?',
  openingHook: 'Một kế hoạch tưởng như hoàn hảo bắt đầu sụp đổ.',
  version: 1,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
});

const generatedJson = JSON.stringify({
  titles: [
    { text: 'Điện Biên Phủ và chiếc bẫy chiến lược', angle: 'curiosity' },
    { text: 'Con số 1954 thay đổi lịch sử', angle: 'number' },
  ],
  description_intro: 'Một phần mở đầu trung thực.',
  tags: ['pháo binh', 'pháo binh', 'lịch sử'],
  hashtags: ['#DienBienPhu', '#Dien Bien Phu', 'LichSu'],
  pinned_comment: 'Bạn nghĩ gì?',
  thumbnail: { ideas: [{ overlay_text: 'Bẫy Sập', concept: 'A mountain pass', image_prompt: 'A cinematic mountain pass' }] },
});

const context = () => ({
  isCancelled: vi.fn(async () => false),
  reportProgress: vi.fn(async () => undefined),
  appendLog: vi.fn(async () => undefined),
});

describe('SEO AI generation', () => {
  beforeEach(() => {
    mocks.chat.mockReset();
    mocks.getAiClient.mockReset().mockImplementation(() => ({ model: 'deepseek-chat', chat: mocks.chat }));
    mocks.getProject.mockReset();
    mocks.applyGeneratedSeoSections.mockReset();
    mocks.getProject.mockResolvedValue(project);
    mocks.applyGeneratedSeoSections.mockImplementation(async () => project);
  });

  it('builds a bounded prompt with only the requested sections and no full narration', () => {
    const prompt = buildSeoPrompt(project, ['titles', 'tags']);

    expect(prompt.promptVersion).toBe('seo-prompt-v1/seo-documentary@5');
    expect(prompt.system).toContain('titles');
    expect(prompt.user).toContain('Requested sections: titles, tags');
    expect(prompt.user).not.toContain('Video visual style');
    expect(prompt.system).toContain('paste-ready image-generator prompt');
    expect(prompt.user).toContain('Mở đầu dài của chương một.');
    expect(prompt.user).not.toContain('Toàn bộ narration không nên đưa vào prompt SEO.');
    expect(prompt.jsonSchema).toMatchObject({ type: 'object' });
  });

  it('uses active scenes only for the SEO duration and opening excerpt', () => {
    const inactive = { ...project.scenes[0]!, id: 'scene-off', narration: 'INACTIVE_SENTINEL', durationSec: 40, active: false };
    const active = { ...project.scenes[0]!, id: 'scene-on', narration: 'ACTIVE_SENTINEL', durationSec: 20, active: true };
    const activeProject = { ...project, scenes: [inactive, active] };

    const prompt = buildSeoPrompt(activeProject, ['titles']);

    expect(prompt.user).toContain('Duration seconds: 20');
    expect(prompt.user).toContain('ACTIVE_SENTINEL');
    expect(prompt.user).not.toContain('INACTIVE_SENTINEL');
  });

  it('maps snake_case output, creates stable ids, removes duplicate tags, and drops invalid hashtags', () => {
    const parsed = parseSeoOutput(generatedJson, ['titles', 'description', 'tags', 'pinnedComment', 'thumbnail']);

    expect(parsed.titles).toEqual([
      { id: 'title-1', text: 'Điện Biên Phủ và chiếc bẫy chiến lược', angle: 'curiosity' },
      { id: 'title-2', text: 'Con số 1954 thay đổi lịch sử', angle: 'number' },
    ]);
    expect(parsed.tags).toEqual(['pháo binh', 'lịch sử']);
    expect(parsed.hashtags).toEqual(['#DienBienPhu']);
    expect(parsed.thumbnail?.ideas[0]?.id).toBe('idea-1');
    expect(Object.keys(parsed)).toEqual(['titles', 'descriptionIntro', 'tags', 'hashtags', 'pinnedComment', 'thumbnail']);
  });

  it('rejects invalid output with a 502 SEO AI output error', () => {
    expect(() => parseSeoOutput('{"titles": [}', ['titles'])).toThrow(SeoAiOutputError);
    try {
      parseSeoOutput('{"titles": [}', ['titles']);
    } catch (error) {
      expect(error).toMatchObject({ status: 502, code: 'SEO_AI_OUTPUT_INVALID' });
    }
  });

  it('retries one validation failure and writes only after the corrected output parses', async () => {
    mocks.chat.mockResolvedValueOnce('{}').mockResolvedValueOnce(generatedJson);
    const jobContext = context();

    await generateSeoPackage(project.id, ['titles', 'tags'], jobContext);

    expect(mocks.getAiClient).toHaveBeenCalledWith('deepseek', 'deepseek-flash');
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(mocks.chat.mock.calls[1]?.[0][1].content).toContain('Validation error:');
    expect(mocks.applyGeneratedSeoSections).toHaveBeenCalledOnce();
    expect(mocks.applyGeneratedSeoSections.mock.calls[0]?.[1]).toEqual(['titles', 'tags']);
    expect(jobContext.appendLog).toHaveBeenCalledWith(expect.stringContaining('retrying once'));
  });

  it('does not write when both validation attempts fail', async () => {
    mocks.chat.mockResolvedValue('{}');
    const jobContext = context();

    await expect(generateSeoPackage(project.id, SEO_SECTIONS, jobContext)).rejects.toMatchObject({ status: 502, code: 'SEO_AI_OUTPUT_INVALID' });
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(mocks.applyGeneratedSeoSections).not.toHaveBeenCalled();
  });

  it('supports the complete section set as the default selection', () => {
    const prompt = buildSeoPrompt(project, SEO_SECTIONS);
    expect(prompt.user).toContain('Requested sections: titles, description, tags, pinnedComment, thumbnail');
  });

  it('parses the checked fixture for a partial section request', () => {
    const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'ai', 'fixtures', 'titles-tags.json');
    const parsed = parseSeoOutput(readFileSync(fixturePath, 'utf8'), ['titles', 'tags']);
    expect(parsed.titles).toHaveLength(2);
    expect(parsed.tags).toEqual(['lịch sử', 'chiến dịch']);
  });
});
