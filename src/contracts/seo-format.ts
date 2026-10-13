import type { ProjectDetail } from './project';
import { secondsToFrames } from './frame-math';
import { activeScenes } from './scene-active';
import {
  SEO_HASHTAGS_MAX_COUNT,
  SEO_THUMBNAIL_MAX_BYTES,
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
  | { ok: true; timestamps: ChapterTimestamp[]; warnings: string[] }
  | { ok: false; reason: string; warnings?: string[] };

/** Match 2+ digit numbers and grouped forms such as 1.954 or 1,954. */
const FACT_NUMBER_RE = /(?<![\p{L}\p{N}])(?:\d{1,3}(?:[.,]\d{3})+|\d{2,})(?![\p{L}\p{N}])/gu;

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
  const warnings: string[] = [];
  for (const chapter of chapters) {
    const count = chapter.scenesCount!;
    const chapterScenes = activeScenes(scenes.slice(sceneIndex, sceneIndex + count));
    sceneIndex += count;
    if (chapterScenes.length === 0) {
      warnings.push(`Chapter ${chapter.no} kh\u00f4ng c\u00f3 scene n\u00e0o \u0111ang b\u1eadt n\u00ean m\u1ed1c th\u1eddi gian \u0111\u00e3 b\u1ecb b\u1ecf qua.`);
      continue;
    }
    const durationInFrames = chapterScenes.reduce((sum, scene) => sum + secondsToFrames(scene.durationSec, fps), 0);
    timestamps.push({
      no: chapter.no,
      title: chapter.title,
      timestamp: formatTimestamp(startFrame / fps),
      startSec: startFrame / fps,
      durationSec: durationInFrames / fps,
      startFrame,
      durationInFrames,
    });
    startFrame += durationInFrames;
  }

  if (timestamps.length < 3) return { ok: false, reason: 'Cần ít nhất 3 chương để tạo mốc YouTube.', warnings };
  if (timestamps[0]?.startFrame !== 0) return { ok: false, reason: 'Mốc chương đầu tiên phải bắt đầu từ 0:00.', warnings };
  if (timestamps.some((timestamp) => timestamp.durationSec < 10)) return { ok: false, reason: 'Mỗi chương phải dài ít nhất 10 giây.', warnings };
  return { ok: true, timestamps, warnings };
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

export type PublishChecklistKey = 'title' | 'description' | 'tags' | 'hashtag' | 'pinnedComment' | 'thumbnail' | 'chapter-timestamps' | 'video';
export type PublishChecklistItem = { key: PublishChecklistKey; label: string; done: boolean; detail: string; warning?: boolean };
export type PublishThumbnailFile = { id: string; mimeType: string; sizeBytes: number };

/** Build the warn-only publish checklist from the project package and optional file metadata. */
export function buildPublishChecklist(project: ProjectDetail, thumbnailFile?: PublishThumbnailFile): PublishChecklistItem[] {
  const seo = project.seo;
  const title = seo.titles.find((item) => item.id === seo.chosenTitleId);
  const tags = tagBudget(seo.tags);
  const hashtags = hashtagStatus(seo.hashtags);
  const thumbnailOk = thumbnailFile
    ? thumbnailFile.id === seo.thumbnail.fileId
      && (thumbnailFile.mimeType === 'image/png' || thumbnailFile.mimeType === 'image/jpeg')
      && thumbnailFile.sizeBytes <= SEO_THUMBNAIL_MAX_BYTES
    : Boolean(seo.thumbnail.fileId);
  const chapterWarnings = chapterTimestamps(project).warnings ?? [];
  return [
    ...(chapterWarnings.length > 0 ? [{ key: 'chapter-timestamps' as const, label: 'M\u1ed1c ch\u01b0\u01a1ng', done: true, warning: true, detail: chapterWarnings.join(' ') }] : []),
    { key: 'title', label: 'Đã chọn tiêu đề', done: Boolean(title && titleStatus(title.text).length <= SEO_TITLE_MAX_CHARS), detail: title?.text ?? 'Chưa chọn tiêu đề.' },
    { key: 'description', label: 'Có mô tả', done: seo.descriptionIntro.trim().length > 0, detail: seo.descriptionIntro.trim() ? 'Mô tả đã có phần mở đầu.' : 'Chưa có phần mở đầu mô tả.' },
    { key: 'tags', label: 'Tags trong ngân sách', done: !tags.overLimit && seo.tags.length > 0, detail: `${tags.used}/${tags.max} ký tự.` },
    { key: 'hashtag', label: 'Có hashtag', done: hashtags.ok && hashtags.count > 0, detail: `${hashtags.count}/${hashtags.max} hashtag.` },
    { key: 'pinnedComment', label: 'Có bình luận ghim', done: seo.pinnedComment.trim().length > 0, detail: seo.pinnedComment.trim() ? 'Đã có bình luận.' : 'Chưa có bình luận.' },
    { key: 'thumbnail', label: 'Thumbnail hợp lệ', done: thumbnailOk, detail: thumbnailOk ? 'PNG/JPEG, trong giới hạn.' : 'Cần thumbnail PNG/JPEG không quá 2 MB.' },
    { key: 'video', label: 'Video đã render', done: Boolean(project.renderFileId), detail: project.renderFileId ? 'Đã có file render.' : 'Chưa render video cuối.' },
  ];
}

export function buildPackageMarkdown(project: ProjectDetail): string {
  const seo = project.seo;
  const title = seo.titles.find((item) => item.id === seo.chosenTitleId)?.text ?? '';
  const idea = seo.thumbnail.ideas.find((item) => item.id === seo.thumbnail.chosenIdeaId);
  const hashtags = normalizeHashtags(seo.hashtags, seo.tags);
  return [
    '# Gói đăng YouTube',
    `Ngày tạo gói: ${project.updatedAt}`,
    '',
    '## Tiêu đề',
    title || '(chưa chọn)',
    '',
    '## Mô tả',
    assembleDescription(seo, project),
    '',
    '## Tags',
    seo.tags.join(', '),
    '',
    '## Hashtag',
    hashtags.join(' '),
    '',
    '## Bình luận ghim',
    seo.pinnedComment,
    '',
    '## Thumbnail',
    idea ? `Chữ: ${idea.overlayText}\nConcept: ${idea.concept}\nPrompt ảnh: ${idea.imagePrompt}` : '(chưa chọn ý tưởng)',
    '',
  ].join('\n');
}

export function slugifyPackageTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'goi-dang-youtube';
}
