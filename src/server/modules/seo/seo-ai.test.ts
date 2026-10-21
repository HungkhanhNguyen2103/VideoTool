import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDetailSchema } from '../../../contracts/project';
import { ChannelSchema } from '../../../contracts/channel';
import { SEO_SECTIONS } from '../../../contracts/seo';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  getAiClient: vi.fn(),
  getProject: vi.fn(),
  getChannel: vi.fn(),
  applyGeneratedSeoSections: vi.fn(),
}));

vi.mock('../../shared/ai', () => ({ getAiClient: mocks.getAiClient }));
vi.mock('../project', () => ({
  getProject: mocks.getProject,
  applyGeneratedSeoSections: mocks.applyGeneratedSeoSections,
}));
vi.mock('../channel', () => ({ getChannel: mocks.getChannel }));

import { buildSeoPrompt } from './ai/build-prompt';
import { parseSeoOutput, SeoAiOutputError } from './ai/parse-output';
import { loadSeoPreset } from './ai/presets/loader';
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
  description_keywords: 'Điện Biên Phủ, chiến dịch năm 1954, địa danh và nhân vật có trong tư liệu.',
  tags: ['pháo binh', 'pháo binh', 'lịch sử'],
  hashtags: ['#DienBienPhu', '#Dien Bien Phu', 'LichSu'],
  pinned_comment: 'Bạn nghĩ gì?',
  thumbnail: { ideas: [{ overlay_text: 'Bẫy Sập', concept: 'A mountain pass', image_prompt: 'A cinematic mountain pass' }] },
});

const channel = ChannelSchema.parse({
  id: 'channel-1',
  name: 'Kênh Sử Việt',
  handle: '@su-viet',
  tagline: 'Lịch sử có nguồn.',
  description: '',
  language: 'vi',
  links: [{ label: 'private link sentinel', url: 'https://example.org/private' }],
  defaultHashtags: ['#LichSu', '#SuViet'],
  descriptionFooter: 'private footer sentinel',
  aiDisclosureText: 'private disclosure sentinel',
  thumbnailTemplate: '',
  publishSchedule: null,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
});

const V7_THUMBNAIL_TEMPLATE = `- Template, left to right:
  1. A thin two-color band (red and gold) along the very top edge, full width.
  2. Right third: one large character, three-quarter bust, sharply outlined, with a clear high-arousal emotion (alarm, realization, dread, resolve; for example wide eyes and a sweat drop), holding in front of him one prop that carries the story (a map, scroll, document, seal, key object). The character is the person at the heart of the tension, in correct period dress and armor of his own side, never a look-alike of a specific real person.
  3. Behind and left of the character: a readable background that shows the situation and the stakes at a glance (for example a force packed between two sealed river mouths), simple enough to read at 320 pixels wide, with strong contrast between the lit foreground and the background.
  4. Left half: the question as large text, three or four short lines, extra-bold condensed white uppercase sans-serif letters, a thin dark outline (about 2 pixels at 1280 wide, never thick) plus a soft dark drop shadow, the whole text block at most about 40 percent of the image width. Never put text in the lower-right corner.`;

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
    mocks.getChannel.mockReset();
    mocks.applyGeneratedSeoSections.mockReset();
    mocks.getProject.mockResolvedValue(project);
    mocks.applyGeneratedSeoSections.mockImplementation(async () => project);
  });

  it('builds a bounded prompt with only the requested sections and no full narration', () => {
    const prompt = buildSeoPrompt(project, ['titles', 'tags']);

    expect(prompt.promptVersion).toBe('seo-prompt-v1/seo-documentary@8');
    expect(prompt.system).toContain('titles');
    expect(prompt.user).toContain('Requested sections: titles, tags');
    expect(prompt.user).not.toContain('Video visual style');
    expect(prompt.system).toContain('paste-ready image-generator prompt');
    expect(prompt.user).toContain('Mở đầu dài của chương một.');
    expect(prompt.user).not.toContain('Toàn bộ narration không nên đưa vào prompt SEO.');
    expect(prompt.jsonSchema).toMatchObject({ type: 'object' });
  });

  it('keeps the v7 thumbnail template text as the default for an unassigned channel', () => {
    const preset = loadSeoPreset();
    const prompt = buildSeoPrompt(project, ['thumbnail']);

    expect(preset.version).toBe(8);
    expect(preset.thumbnailTemplate).toBe(V7_THUMBNAIL_TEMPLATE);
    expect(prompt.system).toContain(V7_THUMBNAIL_TEMPLATE);
    expect(prompt.system).not.toContain('[[THUMBNAIL_TEMPLATE]]');
    expect(prompt.user).not.toMatch(/^Channel:/m);
    expect(prompt.promptVersion).toBe('seo-prompt-v1/seo-documentary@8');
  });

  it('adds only assigned channel context and replaces only the thumbnail template block', () => {
    const assignedProject = { ...project, channelId: channel.id };
    const prompt = buildSeoPrompt(assignedProject, ['thumbnail'], {
      ...channel,
      thumbnailTemplate: 'CHANNEL_TEMPLATE_SENTINEL',
    });

    expect(prompt.user).toContain('Channel:\nName: Kênh Sử Việt\nHandle: @su-viet\nTagline: Lịch sử có nguồn.\nLanguage: vi\nDefault hashtags: ["#LichSu","#SuViet"]');
    expect(prompt.user).not.toContain('private link sentinel');
    expect(prompt.system).not.toContain('private footer sentinel');
    expect(prompt.system).not.toContain('private disclosure sentinel');
    expect(prompt.system).toContain('CHANNEL_TEMPLATE_SENTINEL');
    expect(prompt.system).not.toContain(V7_THUMBNAIL_TEMPLATE);
    expect(prompt.system).toContain('- Look: 2D comic-style digital illustration');
  });

  it('keeps the system prompt identical when an assigned channel has an empty thumbnail override', () => {
    const assignedProject = { ...project, channelId: channel.id };
    expect(buildSeoPrompt(assignedProject, ['thumbnail'], channel).system).toBe(buildSeoPrompt(project, ['thumbnail']).system);
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
    expect(parsed.descriptionKeywords).toBe('Điện Biên Phủ, chiến dịch năm 1954, địa danh và nhân vật có trong tư liệu.');
    expect(Object.keys(parsed)).toEqual(['titles', 'descriptionIntro', 'descriptionKeywords', 'tags', 'hashtags', 'pinnedComment', 'thumbnail']);
  });

  it('preserves omitted keyword output while validating a supplied value', () => {
    expect(parseSeoOutput('{"description_intro":"Intro."}', ['description'])).toEqual({ descriptionIntro: 'Intro.' });
    expect(parseSeoOutput('{"description_intro":"Intro.","description_keywords":""}', ['description'])).toEqual({
      descriptionIntro: 'Intro.',
      descriptionKeywords: '',
    });
    expect(() => parseSeoOutput(JSON.stringify({ description_intro: 'Intro.', description_keywords: 'k'.repeat(801) }), ['description'])).toThrow(SeoAiOutputError);
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
    expect(mocks.getChannel).not.toHaveBeenCalled();
    expect(jobContext.appendLog).toHaveBeenCalledWith(expect.stringContaining('retrying once'));
  });

  it('does not write when both validation attempts fail', async () => {
    mocks.chat.mockResolvedValue('{}');
    const jobContext = context();

    await expect(generateSeoPackage(project.id, SEO_SECTIONS, jobContext)).rejects.toMatchObject({ status: 502, code: 'SEO_AI_OUTPUT_INVALID' });
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(mocks.applyGeneratedSeoSections).not.toHaveBeenCalled();
  });

  it('writes description keywords and merges channel hashtags when those sections are requested', async () => {
    const assignedProject = { ...project, channelId: channel.id };
    mocks.getProject.mockResolvedValue(assignedProject);
    mocks.getChannel.mockResolvedValue(channel);
    mocks.chat.mockResolvedValue(JSON.stringify({
      description_intro: 'Một phần mở đầu trung thực.',
      description_keywords: 'Từ khóa mô tả.',
      tags: ['pháo binh'],
      hashtags: ['#DienBienPhu', '#ChienDich', '#Nam1954', '#DuoiBaTag'],
    }));

    await generateSeoPackage(project.id, ['description', 'tags'], context());

    expect(mocks.getChannel).toHaveBeenCalledWith(channel.id);
    expect(mocks.applyGeneratedSeoSections.mock.calls[0]?.[2]).toMatchObject({
      descriptionIntro: 'Một phần mở đầu trung thực.',
      descriptionKeywords: 'Từ khóa mô tả.',
      hashtags: ['#DienBienPhu', '#ChienDich', '#Nam1954', '#LichSu', '#SuViet', '#DuoiBaTag'],
    });
  });

  it('retries invalid description keywords once and does not write after a repeated failure', async () => {
    const invalid = JSON.stringify({ description_intro: 'Intro.', description_keywords: 'k'.repeat(801) });
    mocks.chat.mockResolvedValue(invalid);

    await expect(generateSeoPackage(project.id, ['description'], context())).rejects.toMatchObject({ code: 'SEO_AI_OUTPUT_INVALID' });

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
