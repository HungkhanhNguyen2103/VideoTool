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

import { buildSeoPrompt, buildShortsPrompt } from './ai/build-prompt';
import { parseSeoOutput, parseShortsOutput, SeoAiOutputError } from './ai/parse-output';
import { loadSeoPreset, loadSeoShortsPreset } from './ai/presets/loader';
import { generateSeoPackage, mergeGeneratedShortsChannelDefaults } from './service';

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

function projectWithShortWindow() {
  const sourceScene = project.scenes[0]!;
  return {
    ...project,
    scenes: [1, 2, 3, 4].map((number) => ({ ...sourceScene, id: `short-scene-${number}`, narration: `Narration for short scene ${number}.`, durationSec: 10, active: true })),
    chapters: [{ ...project.chapters[0]!, id: 'chapter-short', no: 1, title: 'Bước ngoặt', role: 'climax' as const, scenesCount: 4, durationSec: 40 }],
  };
}

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

  it('loads the independent versioned Shorts preset and builds a timecode-free channel-aware prompt', () => {
    const preset = loadSeoShortsPreset();
    const assignedProject = { ...project, channelId: channel.id };
    const window = { id: 'short-scene-1', startSec: 0, endSec: 30, chapterNo: 1, sceneIds: ['scene-1'], sceneStartIndex: 0, sceneEndIndex: 0 };
    const prompt = buildShortsPrompt(assignedProject, [window], channel);

    expect(preset).toMatchObject({ id: 'seo-shorts', version: 1 });
    expect(prompt.promptVersion).toBe('seo-shorts-prompt-v1/seo-shorts@1');
    expect(prompt.system).toContain('first 2 seconds');
    expect(prompt.system).toContain('Do not invent');
    expect(prompt.user).toContain('window_id: short-scene-1');
    expect(prompt.user).toContain('chapter title: Mở đầu');
    expect(prompt.user).toContain('duration: 30 seconds');
    expect(prompt.user).toContain('Mở đầu dài của chương một.');
    expect(prompt.user).toContain('Default hashtags: ["#LichSu","#SuViet"]');
    expect(prompt.user).not.toContain('startSec');
    expect(prompt.user).not.toContain('00:00');
    expect(prompt.jsonSchema).toMatchObject({ type: 'object' });
  });

  it('parses Shorts by exact window id and joins deterministic timing data in window order', () => {
    const windows = [
      { id: 'short-a', startSec: 0, endSec: 30, chapterNo: 1, sceneIds: ['scene-1'], sceneStartIndex: 0, sceneEndIndex: 0 },
      { id: 'short-b', startSec: 30, endSec: 60, chapterNo: 2, sceneIds: ['scene-2'], sceneStartIndex: 1, sceneEndIndex: 1 },
    ];
    const raw = JSON.stringify({ shorts: [
      { window_id: 'short-b', hook_line: 'B', title: 'Title B', caption: 'Caption B', hashtags: ['#History'], reason: 'B reason' },
      { window_id: 'short-a', hook_line: 'A', title: 'Title A', caption: 'Caption A', hashtags: ['#History'], reason: 'A reason' },
    ] });
    const parsed = parseShortsOutput(raw, windows);
    expect(parsed.shorts.map((short) => [short.id, short.startSec, short.endSec, short.chapterNo])).toEqual([
      ['short-a', 0, 30, 1], ['short-b', 30, 60, 2],
    ]);
    expect(parsed.shorts[0]?.hashtags).toEqual(['#History', '#Shorts']);
  });

  it('merges channel defaults into Shorts hashtags and still reserves #Shorts within five', () => {
    const merged = mergeGeneratedShortsChannelDefaults({ shorts: [{
      id: 'short-a', startSec: 0, endSec: 30, chapterNo: 1, hookLine: '', title: '', caption: '',
      hashtags: ['#AiOne', '#AiTwo', '#AiThree', '#AiFour', '#AiFive'], reason: '',
    }] }, channel);
    expect(merged.shorts?.[0]?.hashtags).toEqual(['#AiOne', '#AiTwo', '#AiThree', '#LichSu', '#Shorts']);
  });

  it('keeps #Shorts when channel defaults push it beyond the fifth merged hashtag', () => {
    const merged = mergeGeneratedShortsChannelDefaults({ shorts: [{
      id: 'short-a', startSec: 0, endSec: 30, chapterNo: 1, hookLine: '', title: '', caption: '',
      hashtags: ['#AiOne', '#AiTwo', '#AiThree', '#AiFour', '#Shorts'], reason: '',
    }] }, channel);
    expect(merged.shorts?.[0]?.hashtags).toEqual(['#AiOne', '#AiTwo', '#AiThree', '#LichSu', '#Shorts']);
  });

  it.each([
    ['missing', [{ window_id: 'short-a', hook_line: 'A', title: 'A', caption: 'A', hashtags: [], reason: 'A' }]],
    ['extra', [
      { window_id: 'short-a', hook_line: 'A', title: 'A', caption: 'A', hashtags: [], reason: 'A' },
      { window_id: 'short-b', hook_line: 'B', title: 'B', caption: 'B', hashtags: [], reason: 'B' },
      { window_id: 'short-c', hook_line: 'C', title: 'C', caption: 'C', hashtags: [], reason: 'C' },
    ]],
    ['duplicate', [
      { window_id: 'short-a', hook_line: 'A', title: 'A', caption: 'A', hashtags: [], reason: 'A' },
      { window_id: 'short-a', hook_line: 'A2', title: 'A2', caption: 'A2', hashtags: [], reason: 'A2' },
    ]],
  ])('rejects %s window ids in Shorts output', (_label, shorts) => {
    expect(() => parseShortsOutput(JSON.stringify({ shorts }), [
      { id: 'short-a', startSec: 0, endSec: 30, chapterNo: 1, sceneIds: ['scene-1'], sceneStartIndex: 0, sceneEndIndex: 0 },
      { id: 'short-b', startSec: 30, endSec: 60, chapterNo: 2, sceneIds: ['scene-2'], sceneStartIndex: 1, sceneEndIndex: 1 },
    ])).toThrow(SeoAiOutputError);
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
    expect(mocks.applyGeneratedSeoSections.mock.calls[0]?.[2]).toMatchObject({ generatedBy: { backend: 'api' } });
    expect(mocks.getChannel).not.toHaveBeenCalled();
    expect(jobContext.appendLog).toHaveBeenCalledWith(expect.stringContaining('retrying once'));
  });

  it('generates through an injected Claude CLI backend without constructing the API client and records CLI metadata', async () => {
    const cli = { kind: 'cli' as const, model: 'claude-sonnet-5-5', chat: vi.fn(async () => `Here is the package:\n\`\`\`json\n${generatedJson}\n\`\`\``) };
    const jobContext = context();

    await generateSeoPackage(project.id, ['titles', 'tags'], jobContext, cli);

    expect(mocks.getAiClient).not.toHaveBeenCalled();
    expect(cli.chat).toHaveBeenCalledOnce();
    expect(mocks.applyGeneratedSeoSections).toHaveBeenCalledWith(project.id, ['titles', 'tags'], expect.objectContaining({
      generatedBy: expect.objectContaining({ provider: 'claude', model: 'claude-sonnet-5-5', backend: 'cli' }),
    }));
  });

  it('retries CLI validation failures once, tolerates leading prose, and leaves projects unchanged when cancelled', async () => {
    const cli = { kind: 'cli' as const, model: 'default', chat: vi.fn()
      .mockResolvedValueOnce('Not valid JSON')
      .mockResolvedValueOnce(`The corrected result follows.\n${generatedJson}`) };
    const jobContext = context();

    await generateSeoPackage(project.id, ['titles'], jobContext, cli);

    expect(cli.chat).toHaveBeenCalledTimes(2);
    expect(jobContext.appendLog).toHaveBeenCalledWith(expect.stringContaining('retrying once'));
    expect(mocks.applyGeneratedSeoSections).toHaveBeenCalledOnce();

    mocks.applyGeneratedSeoSections.mockClear();
    const cancelledContext = { ...context(), isCancelled: vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true) };
    const cancelledCli = { kind: 'cli' as const, model: 'default', chat: vi.fn(async () => generatedJson) };
    await generateSeoPackage(project.id, ['titles'], cancelledContext, cancelledCli);
    expect(cancelledCli.chat).toHaveBeenCalledOnce();
    expect(mocks.applyGeneratedSeoSections).not.toHaveBeenCalled();
  });

  it('does not write when both CLI validation attempts fail', async () => {
    const cli = { kind: 'cli' as const, model: 'default', chat: vi.fn().mockResolvedValue('not JSON') };

    await expect(generateSeoPackage(project.id, ['titles'], context(), cli)).rejects.toMatchObject({ status: 502, code: 'SEO_AI_OUTPUT_INVALID' });

    expect(cli.chat).toHaveBeenCalledTimes(2);
    expect(mocks.applyGeneratedSeoSections).not.toHaveBeenCalled();
  });

  it('keeps CLI main and Shorts calls sequential and merges assigned channel defaults', async () => {
    const eligible = { ...projectWithShortWindow(), channelId: channel.id };
    mocks.getProject.mockResolvedValue(eligible);
    mocks.getChannel.mockResolvedValue(channel);
    let active = 0;
    let maxActive = 0;
    const cli = {
      kind: 'cli' as const,
      model: 'claude-sonnet-5-5',
      chat: vi.fn(async (messages: Array<{ role: string; content: string }>, options?: { stepLabel?: string }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return options?.stepLabel === 'Shorts-windows'
          ? JSON.stringify({ shorts: [{ window_id: 'short-short-scene-1', hook_line: 'Hook', title: 'Short title', caption: 'Caption', hashtags: ['#History'], reason: 'Reason' }] })
          : JSON.stringify({ tags: ['lịch sử'], hashtags: ['#DienBienPhu'] });
      }),
    };

    await generateSeoPackage(project.id, ['tags', 'shorts'], context(), cli);

    expect(cli.chat).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(mocks.applyGeneratedSeoSections).toHaveBeenCalledWith(eligible.id, ['tags', 'shorts'], expect.objectContaining({
      hashtags: ['#DienBienPhu', '#SuViet'],
      shorts: [expect.objectContaining({ hashtags: ['#History', '#Shorts', '#LichSu', '#SuViet'] })],
    }));
  });

  it('does not retry CLI process failures as schema failures', async () => {
    const cli = { kind: 'cli' as const, model: 'default', chat: vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { code: 'CLAUDE_CLI_TIMEOUT', status: 503 })) };

    await expect(generateSeoPackage(project.id, ['titles'], context(), cli)).rejects.toMatchObject({ code: 'CLAUDE_CLI_TIMEOUT' });

    expect(cli.chat).toHaveBeenCalledOnce();
    expect(mocks.applyGeneratedSeoSections).not.toHaveBeenCalled();
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

  it('generates Shorts in a separate AI call and keeps main-call prompt metadata', async () => {
    const eligible = projectWithShortWindow();
    mocks.getProject.mockResolvedValue(eligible);
    mocks.chat.mockResolvedValueOnce(JSON.stringify({ titles: [{ text: 'A title', angle: 'curiosity' }] }))
      .mockResolvedValueOnce(JSON.stringify({ shorts: [{ window_id: 'short-short-scene-1', hook_line: 'A hook', title: 'Short title', caption: 'Watch {LONG_VIDEO_URL}', hashtags: ['#History'], reason: 'A reason' }] }));

    await generateSeoPackage(project.id, ['titles', 'shorts'], context());

    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(mocks.chat.mock.calls[0]?.[0][1].content).toContain('Requested sections: titles');
    expect(mocks.chat.mock.calls[0]?.[0][1].content).not.toContain('window_id');
    expect(mocks.chat.mock.calls[1]?.[0][1].content).toContain('window_id: short-short-scene-1');
    expect(mocks.applyGeneratedSeoSections).toHaveBeenCalledWith(eligible.id, ['titles', 'shorts'], expect.objectContaining({
      titles: [{ id: 'title-1', text: 'A title', angle: 'curiosity' }],
      shorts: [expect.objectContaining({ id: 'short-short-scene-1', startSec: 0, endSec: 40, chapterNo: 1, hashtags: ['#History', '#Shorts'] })],
      generatedBy: expect.objectContaining({ promptVersion: 'seo-prompt-v1/seo-documentary@8' }),
    }));
  });

  it.each([
    ['missing', JSON.stringify({ shorts: [] })],
    ['extra', JSON.stringify({ shorts: [
      { window_id: 'short-short-scene-1', hook_line: 'A', title: 'A', caption: 'A', hashtags: [], reason: 'A' },
      { window_id: 'short-unexpected', hook_line: 'B', title: 'B', caption: 'B', hashtags: [], reason: 'B' },
    ] })],
    ['duplicate', JSON.stringify({ shorts: [
      { window_id: 'short-short-scene-1', hook_line: 'A', title: 'A', caption: 'A', hashtags: [], reason: 'A' },
      { window_id: 'short-short-scene-1', hook_line: 'B', title: 'B', caption: 'B', hashtags: [], reason: 'B' },
    ] })],
  ])('retries %s window ID mismatch once and then writes nothing', async (_label, invalidOutput) => {
    mocks.getProject.mockResolvedValue(projectWithShortWindow());
    mocks.chat.mockResolvedValue(invalidOutput);

    await expect(generateSeoPackage(project.id, ['shorts'], context())).rejects.toMatchObject({ status: 502, code: 'SEO_AI_OUTPUT_INVALID' });

    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(mocks.chat.mock.calls[1]?.[0][1].content).toContain('Validation error:');
    expect(mocks.applyGeneratedSeoSections).not.toHaveBeenCalled();
  });

  it('stores an empty Shorts section without constructing or calling an AI client when no windows qualify', async () => {
    await generateSeoPackage(project.id, ['shorts'], context());

    expect(mocks.getAiClient).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.applyGeneratedSeoSections).toHaveBeenCalledWith(project.id, ['shorts'], expect.objectContaining({
      shorts: [],
      generatedBy: expect.objectContaining({ promptVersion: 'seo-shorts-prompt-v1/seo-shorts@1' }),
    }));
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
