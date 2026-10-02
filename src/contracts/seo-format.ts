import type { ProjectDetail } from './project';
import {
  SEO_HASHTAGS_MAX_COUNT,
  SEO_TAGS_MAX_CHARS,
  SEO_THUMBNAIL_MAX_WORDS,
  SEO_TITLE_MAX_CHARS,
  SEO_TITLE_RECOMMENDED_MAX_CHARS,
  normalizeHashtags,
  type SeoPackage,
} from './seo';

type TimingProject = Pick<ProjectDetail, 'chapters' | 'scenes' | 'renderSettings'>;

export type ChapterTimestamp = {
  no: number;
  title: string;
  timestamp: string;
  startSec: number;
  durationSec: number;
  startFrame: number;
  durationInFrames: number;
};

export type ChapterTimestampsResult =
  | { ok: true; timestamps: ChapterTimestamp[] }
  | { ok: false; reason: string };

/** Match 2+ digit numbers and grouped forms such as 1.954 or 1,954. */
const FACT_NUMBER_RE = /(?<![\p{L}\p{N}])(?:\d{1,3}(?:[.,]\d{3})+|\d{2,})(?![\p{L}\p{N}])/gu;

function sceneDurationInFrames(durationSec: number, fps: number): number {
  return Math.round(durationSec * fps);
}

function numberKey(value: string): string {
  return value.replace(/[.,]/g, '');
}

function extractedFacts(text: string): string[] {
  return text.match(FACT_NUMBER_RE) ?? [];
}

/** Format a whole-second YouTube timestamp as m:ss or h:mm:ss. */
export function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const remainder = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${Math.floor(totalSeconds / 60)}:${String(remainder).padStart(2, '0')}`;
}

/**
 * Build chapter starts from the same per-scene rounded frame durations as Remotion's
 * sceneFrameTimings. Transitions extend visual layers but do not move the next scene's
 * start frame or the composition duration, so no overlap is added here.
 */
export function chapterTimestamps(project: TimingProject): ChapterTimestampsResult {
  const { scenes, chapters, renderSettings } = project;
  const fps = renderSettings.fps;
  if (scenes.length === 0) return { ok: false, reason: 'Chưa có cảnh đã chốt.' };

  const counts = chapters.map((chapter) => chapter.scenesCount);
  const sceneCountTotal = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  if (counts.some((count) => count == null || !Number.isInteger(count) || count < 0) || sceneCountTotal !== scenes.length) {
    return { ok: false, reason: 'Số cảnh theo chương chưa khớp với video.' };
  }

  let sceneIndex = 0;
  let startFrame = 0;
  const timestamps: ChapterTimestamp[] = [];
  for (const chapter of chapters) {
    const count = chapter.scenesCount!;
    let durationInFrames = 0;
    for (let offset = 0; offset < count; offset += 1) {
      durationInFrames += sceneDurationInFrames(scenes[sceneIndex + offset]!.durationSec, fps);
    }
    timestamps.push({
      no: chapter.no,
      title: chapter.title,
      timestamp: formatTimestamp(startFrame / fps),
      startSec: startFrame / fps,
      durationSec: durationInFrames / fps,
      startFrame,
      durationInFrames,
    });
    sceneIndex += count;
    startFrame += durationInFrames;
  }

  if (timestamps.length < 3) return { ok: false, reason: 'Cần ít nhất 3 chương để tạo mốc YouTube.' };
  if (timestamps[0]?.startFrame !== 0) return { ok: false, reason: 'Mốc chương đầu tiên phải bắt đầu từ 0:00.' };
  if (timestamps.some((timestamp) => timestamp.durationSec < 10)) return { ok: false, reason: 'Mỗi chương phải dài ít nhất 10 giây.' };
  return { ok: true, timestamps };
}

export function assembleDescription(seo: Pick<SeoPackage, 'descriptionIntro' | 'hashtags' | 'tags'>, project: TimingProject): string {
  const sections: string[] = [];
  const intro = seo.descriptionIntro.trim();
  if (intro) sections.push(intro);

  const chapters = chapterTimestamps(project);
  if (chapters.ok) {
    sections.push([
      'Mốc chương:',
      ...chapters.timestamps.map((chapter) => `${chapter.timestamp} ${chapter.title}`),
    ].join('\n'));
  }

  const hashtags = normalizeHashtags(seo.hashtags, seo.tags);
  if (hashtags.length > 0) sections.push(hashtags.slice(0, SEO_HASHTAGS_MAX_COUNT).join(' '));
  return sections.join('\n\n');
}

export type TitleStatus = {
  length: number;
  max: number;
  recommendedMax: number;
  recommended: boolean;
  warning: boolean;
  overLimit: boolean;
};

export function titleStatus(text: string): TitleStatus {
  const length = text.length;
  return {
    length,
    max: SEO_TITLE_MAX_CHARS,
    recommendedMax: SEO_TITLE_RECOMMENDED_MAX_CHARS,
    recommended: length <= SEO_TITLE_RECOMMENDED_MAX_CHARS,
    warning: length > SEO_TITLE_RECOMMENDED_MAX_CHARS,
    overLimit: length > SEO_TITLE_MAX_CHARS,
  };
}

export type TagBudget = { used: number; max: number; remaining: number; overLimit: boolean };

/** YouTube counts the comma separators in the tags input, so measure `tags.join(',')`. */
export function tagBudget(tags: readonly string[]): TagBudget {
  const used = tags.map((tag) => tag.trim()).filter(Boolean).join(',').length;
  return { used, max: SEO_TAGS_MAX_CHARS, remaining: Math.max(0, SEO_TAGS_MAX_CHARS - used), overLimit: used > SEO_TAGS_MAX_CHARS };
}

export type HashtagStatus = {
  count: number;
  max: number;
  overLimit: boolean;
  invalidCount: number;
  duplicateCount: number;
  ok: boolean;
};

export function hashtagStatus(hashtags: readonly string[]): HashtagStatus {
  const seen = new Set<string>();
  let duplicateCount = 0;
  let invalidCount = 0;
  for (const hashtag of hashtags) {
    if (!/^#[A-Z][A-Za-z0-9]*$/.test(hashtag)) invalidCount += 1;
    const key = hashtag.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (seen.has(key)) duplicateCount += 1;
    seen.add(key);
  }
  const overLimit = hashtags.length > SEO_HASHTAGS_MAX_COUNT;
  return { count: hashtags.length, max: SEO_HASHTAGS_MAX_COUNT, overLimit, invalidCount, duplicateCount, ok: !overLimit && invalidCount === 0 && duplicateCount === 0 };
}

export type ThumbnailTextStatus = { words: number; max: number; overLimit: boolean };

export function thumbnailTextStatus(text: string): ThumbnailTextStatus {
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return { words, max: SEO_THUMBNAIL_MAX_WORDS, overLimit: words > SEO_THUMBNAIL_MAX_WORDS };
}

/** Return distinct number tokens mentioned in the package text but absent from the source. */
export function findUnsupportedFacts(texts: readonly string[], sourceText: string): string[] {
  const sourceFacts = new Set(extractedFacts(sourceText).map(numberKey));
  const seen = new Set<string>();
  const unsupported: string[] = [];
  for (const text of texts) {
    for (const fact of extractedFacts(text)) {
      const key = numberKey(fact);
      if (!sourceFacts.has(key) && !seen.has(key)) {
        seen.add(key);
        unsupported.push(fact);
      }
    }
  }
  return unsupported;
}
