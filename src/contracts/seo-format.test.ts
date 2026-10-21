import { describe, expect, it } from 'vitest';
import { sceneFrameTimings, sceneVisualTimings, totalDurationInFrames } from '../remotion/frame-math';
import type { ProjectDetail } from './project';
import type { Channel } from './channel';
import type { SeoPackage } from './seo';
import {
  assembleDescription,
  assembleDescriptionDetailed,
  chapterTimestamps,
  findUnsupportedFacts,
  formatTimestamp,
  hashtagStatus,
  mergeChannelHashtags,
  tagBudget,
  thumbnailTextStatus,
  titleStatus,
} from './seo-format';

type TimingProject = Pick<ProjectDetail, 'chapters' | 'scenes' | 'renderSettings' | 'referencesText' | 'language' | 'channelId'>;

function projectWithScenes(durations: number[], sceneCounts: number[], fps = 24): TimingProject {
  return {
    referencesText: '',
    language: 'vi',
    channelId: null,
    renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: fps as 24 | 30 | 60 },
    scenes: durations.map((durationSec, index) => ({
      id: `scene-${index + 1}`,
      narration: `Narration ${index + 1}`,
      visualPrompt: '',
      shotType: null,
      lightType: null,
      durationSec,
      active: true,
      assetType: 'image' as const,
      assetFileId: `asset-${index + 1}`,
      audioFileId: null,
      voiceoverDurationSec: null,
      voiceoverInput: null,
      wordTimings: null,
      sfxPrompt: '',
      motionPrompt: '',
      sfxFileId: null,
      videoKeyframeFileId: null,
      videoTailFileId: null,
      videoDurationSec: null,
      depthMap: null,
      nameCandidates: null,
      popupPlan: null,
    })),
    chapters: sceneCounts.map((scenesCount, index) => ({
      id: `chapter-${index + 1}`,
      no: index + 1,
      title: `Chương ${index + 1}`,
      paragraphs: ['Paragraph'],
      status: 'approved' as const,
      scenesCount,
      durationSec: null,
      role: null,
      beat: '',
      targetWords: null,
      endsOnTension: false,
      chapterSummary: null,
      avoidRepeating: [],
      persistentFacts: [],
      reviewStatus: 'clean' as const,
    })),
  };
}

const emptySeo: SeoPackage = {
  titles: [],
  chosenTitleId: null,
  descriptionIntro: '',
  descriptionKeywords: '',
  tags: [],
  hashtags: [],
  pinnedComment: '',
  thumbnail: { ideas: [], chosenIdeaId: null, fileId: null },
  shorts: [],
  longVideoUrl: '',
  generatedBy: null,
};

const channel: Channel = {
  id: 'channel-1',
  name: 'Kênh Sử Việt',
  handle: '@su-viet',
  tagline: '',
  description: '',
  language: 'vi',
  links: [{ label: 'Trang chủ', url: 'https://example.org/channel' }],
  defaultHashtags: ['#LichSu', '#SuViet'],
  descriptionFooter: 'Theo dõi Kênh Sử Việt.',
  aiDisclosureText: 'Một số cảnh được tạo bằng AI.',
  thumbnailTemplate: '',
  publishSchedule: null,
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
};

describe('SEO format helpers', () => {
  it('formats minute and hour timestamps', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(65)).toBe('1:05');
    expect(formatTimestamp(3661)).toBe('1:01:01');
  });

  it('uses per-scene rounded frame starts, matching Remotion sceneFrameTimings', () => {
    const project = projectWithScenes([10.01, 10.02, 10.03], [1, 1, 1], 24);
    const result = chapterTimestamps(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sceneTimings = sceneFrameTimings(project.scenes, project.renderSettings.fps);
    expect(result.timestamps.map((item) => item.startSec * project.renderSettings.fps)).toEqual(
      sceneTimings.map((item) => item.from),
    );
    expect(result.timestamps.map((item) => item.timestamp)).toEqual(['0:00', '0:10', '0:20']);
    expect(result.timestamps.reduce((sum, item) => sum + item.durationInFrames, 0)).toBe(
      totalDurationInFrames(project.scenes, project.renderSettings.fps),
    );
    expect(sceneVisualTimings(project.scenes, project.renderSettings.fps, 'crossfade').map((item) => item.from)).toEqual(
      sceneTimings.map((item) => item.from),
    );
  });

  it('uses active scenes for chapter frame starts and skips an all-inactive chapter with a warning', () => {
    const project = projectWithScenes([10.01, 18, 10.03, 10.04], [1, 1, 1, 1], 24);
    project.scenes[1]!.active = false;

    const result = chapterTimestamps(project);

    expect(result).toMatchObject({ ok: true, warnings: [expect.stringContaining('Chapter 2')] });
    if (!result.ok) return;
    expect(result.timestamps.map(({ no, startFrame, durationInFrames }) => ({ no, startFrame, durationInFrames }))).toEqual([
      { no: 1, startFrame: 0, durationInFrames: 240 },
      { no: 3, startFrame: 240, durationInFrames: 241 },
      { no: 4, startFrame: 481, durationInFrames: 241 },
    ]);
    expect(assembleDescription({ descriptionIntro: '', hashtags: [], tags: [] }, project)).toContain('0:10 Chương 3');
    expect(assembleDescription({ descriptionIntro: '', hashtags: [], tags: [] }, project)).not.toContain('Chương 2');

    const fewerActiveChapters = projectWithScenes([10, 10, 10], [1, 1, 1]);
    fewerActiveChapters.scenes[1]!.active = false;
    expect(chapterTimestamps(fewerActiveChapters)).toMatchObject({
      ok: false,
      warnings: [expect.stringContaining('Chapter 2')],
    });
  });

  it('rejects missing scenes, mismatched scene counts, fewer than three chapters, and short chapters', () => {
    expect(chapterTimestamps(projectWithScenes([], []))).toMatchObject({ ok: false });
    expect(chapterTimestamps(projectWithScenes([10, 10, 10], [2, 2]))).toMatchObject({ ok: false });
    expect(chapterTimestamps(projectWithScenes([10, 10], [1, 1]))).toMatchObject({ ok: false });
    expect(chapterTimestamps(projectWithScenes([9.5, 10, 10], [1, 1, 1]))).toMatchObject({ ok: false });
  });

  it('assembles intro, valid chapter timestamps, and unique hashtags', () => {
    const project = projectWithScenes([10, 10, 10], [1, 1, 1]);
    const seo = { ...emptySeo, descriptionIntro: 'Mở đầu.', hashtags: ['#DienBienPhu', '#DienBienPhu', '#LichSu'] };

    expect(assembleDescription(seo, project)).toBe('Mở đầu.\n\nMốc chương:\n0:00 Chương 1\n0:10 Chương 2\n0:20 Chương 3\n\n#DienBienPhu #LichSu');
  });

  it('merges channel hashtags after the first three AI tags and fills missing visible slots', () => {
    expect(mergeChannelHashtags(
      ['#AIEvent', '#AIPerson', '#AIEra', '#AITail'],
      ['#ChannelOne', '#ChannelTwo'],
      [],
    )).toEqual(['#AIEvent', '#AIPerson', '#AIEra', '#ChannelOne', '#ChannelTwo', '#AITail']);
    expect(mergeChannelHashtags(['#AIOnly'], ['#DefaultOne', '#DefaultTwo', '#DefaultThree', '#DefaultFour'], [])).toEqual([
      '#AIOnly', '#DefaultOne', '#DefaultTwo', '#DefaultThree', '#DefaultFour',
    ]);
    expect(mergeChannelHashtags(['#One', '#Two', '#Three', '#Four'], [], [])).toEqual(['#One', '#Two', '#Three', '#Four']);
  });

  it('deduplicates hashtags against tags and caps the merged channel result', () => {
    expect(mergeChannelHashtags(['#Event', '#Person', '#Era', '#Tail'], ['#Event', '#Channel'], ['event'])).toEqual([
      '#Person', '#Era', '#Channel', '#Tail',
    ]);
    const manyAi = Array.from({ length: 15 }, (_, index) => `#Ai${index + 1}`);
    const manyDefaults = Array.from({ length: 5 }, (_, index) => `#Channel${index + 1}`);
    const merged = mergeChannelHashtags(manyAi, manyDefaults, []);
    expect(merged).toHaveLength(15);
    expect(merged.slice(0, 3)).toEqual(manyAi.slice(0, 3));
    expect(merged.slice(3, 8)).toEqual(manyDefaults);
  });

  it('assembles localized sources, channel links, footer, disclosure, and hashtags in order', () => {
    const project = { ...projectWithScenes([10, 10, 10], [1, 1, 1]), referencesText: '[1] Archive: https://example.org/source', channelId: channel.id };
    const seo = { ...emptySeo, descriptionIntro: 'Intro.', descriptionKeywords: 'Từ khóa.', hashtags: ['#DienBienPhu'] };
    const result = assembleDescriptionDetailed(seo, project, channel);

    expect(result).toEqual({ text: [
      'Intro.',
      'Từ khóa.',
      'Mốc chương:\n0:00 Chương 1\n0:10 Chương 2\n0:20 Chương 3',
      'Nguồn tham khảo:\n1. Archive: https://example.org/source',
      'Trang chủ: https://example.org/channel',
      'Theo dõi Kênh Sử Việt.',
      'Một số cảnh được tạo bằng AI.',
      '#DienBienPhu',
    ].join('\n\n'), trimmed: [], overLimit: false });
    expect(assembleDescription(seo, project, channel)).toBe(result.text);
  });

  it('uses the English sources heading and omits empty optional blocks', () => {
    const project = { ...projectWithScenes([], []), language: 'en' as const, referencesText: '1) Record - https://example.org/record' };
    const result = assembleDescriptionDetailed({ ...emptySeo, descriptionIntro: 'Intro.' }, project);
    expect(result.text).toBe('Intro.\n\nSources:\n1. Record: https://example.org/record');
  });

  it('drops the whole sources block before keywords when the assembled description exceeds its limit', () => {
    const project = {
      ...projectWithScenes([], []),
      referencesText: `1. ${'source '.repeat(150)}https://example.org/source`,
    };
    const seo = { ...emptySeo, descriptionIntro: 'i'.repeat(4500), descriptionKeywords: 'k'.repeat(800) };
    const result = assembleDescriptionDetailed(seo, project);
    expect(result.trimmed).toEqual(['sources', 'keywords']);
    expect(result.overLimit).toBe(false);
    expect(result.text).not.toContain('Sources:');
    expect(result.text).not.toContain('k'.repeat(20));
  });

  it('keeps required description blocks and reports when they still exceed the limit', () => {
    const project = { ...projectWithScenes([], []), referencesText: '' };
    const seo = { ...emptySeo, descriptionIntro: 'i'.repeat(5000), descriptionKeywords: 'keyword', hashtags: ['#Tag'] };
    const result = assembleDescriptionDetailed(seo, project);
    expect(result.trimmed).toEqual(['keywords']);
    expect(result.overLimit).toBe(true);
    expect(result.text.startsWith('i'.repeat(5000))).toBe(true);
  });

  it('reports title, tag, hashtag, and thumbnail text boundaries', () => {
    expect(titleStatus('a'.repeat(70))).toMatchObject({ length: 70, recommended: true, overLimit: false });
    expect(titleStatus('a'.repeat(101)).overLimit).toBe(true);
    expect(tagBudget(['a'.repeat(499)])).toMatchObject({ used: 499, remaining: 1, overLimit: false });
    expect(tagBudget(['a'.repeat(250), 'b'.repeat(250)]).used).toBe(501);
    expect(hashtagStatus(Array.from({ length: 16 }, (_, index) => `#Tag${index}`)).overLimit).toBe(true);
    expect(thumbnailTextStatus('VÌ SAO 300 THUYỀN KHÔNG THOÁT ĐƯỢC?')).toMatchObject({ words: 7, max: 8, overLimit: false });
    expect(thumbnailTextStatus('Một hai ba bốn năm sáu bảy tám chín')).toMatchObject({ words: 9, overLimit: true });
  });

  it('returns only unsupported multi-digit facts and canonicalizes separators', () => {
    expect(findUnsupportedFacts(['Điện Biên Phủ 1954', 'Quân số 1.954', 'Năm 2026'], 'Nguồn ghi năm 1954 và quân số 1954.')).toEqual(['2026']);
    expect(findUnsupportedFacts(['Có 7 ngày và 12 trận'], 'Nguồn ghi 7 ngày và 12 trận.')).toEqual([]);
  });
});
