import { describe, expect, it } from 'vitest';
import { sceneFrameTimings, sceneVisualTimings, totalDurationInFrames } from '../remotion/frame-math';
import type { ProjectDetail } from './project';
import type { SeoPackage } from './seo';
import {
  assembleDescription,
  chapterTimestamps,
  findUnsupportedFacts,
  formatTimestamp,
  hashtagStatus,
  tagBudget,
  thumbnailTextStatus,
  titleStatus,
} from './seo-format';

type TimingProject = Pick<ProjectDetail, 'chapters' | 'scenes' | 'renderSettings'>;

function projectWithScenes(durations: number[], sceneCounts: number[], fps = 24): TimingProject {
  return {
    renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: fps as 24 | 30 | 60 },
    scenes: durations.map((durationSec, index) => ({
      id: `scene-${index + 1}`,
      narration: `Narration ${index + 1}`,
      visualPrompt: '',
      durationSec,
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
  tags: [],
  hashtags: [],
  pinnedComment: '',
  thumbnail: { ideas: [], chosenIdeaId: null, fileId: null },
  generatedBy: null,
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

  it('reports title, tag, hashtag, and thumbnail text boundaries', () => {
    expect(titleStatus('a'.repeat(70))).toMatchObject({ length: 70, recommended: true, overLimit: false });
    expect(titleStatus('a'.repeat(101)).overLimit).toBe(true);
    expect(tagBudget(['a'.repeat(499)])).toMatchObject({ used: 499, remaining: 1, overLimit: false });
    expect(tagBudget(['a'.repeat(250), 'b'.repeat(250)]).used).toBe(501);
    expect(hashtagStatus(Array.from({ length: 16 }, (_, index) => `#Tag${index}`)).overLimit).toBe(true);
    expect(thumbnailTextStatus('Một chữ hai ba bốn năm')).toMatchObject({ words: 6, overLimit: true });
  });

  it('returns only unsupported multi-digit facts and canonicalizes separators', () => {
    expect(findUnsupportedFacts(['Điện Biên Phủ 1954', 'Quân số 1.954', 'Năm 2026'], 'Nguồn ghi năm 1954 và quân số 1954.')).toEqual(['2026']);
    expect(findUnsupportedFacts(['Có 7 ngày và 12 trận'], 'Nguồn ghi 7 ngày và 12 trận.')).toEqual([]);
  });
});
