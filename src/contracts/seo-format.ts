import type { Channel } from './channel';
import type { ProjectDetail } from './project';
import { secondsToFrames } from './frame-math';
import { activeScenes } from './scene-active';
import { parseSourceReferences } from './seo-sources';
import { formatSlotLabel, nextPublishSlots, PUBLISH_LEAD_HOURS_MAX, PUBLISH_LEAD_HOURS_MIN } from './channel-schedule';
import { findDuplicateTitle } from './seo-duplicates';
import { pickShortsWindows, sameShortsWindowFields } from './seo-shorts';
import {
  SEO_DESCRIPTION_MAX_CHARS,
  SEO_HASHTAGS_MAX_COUNT,
  SEO_HASHTAGS_VISIBLE_COUNT,
  SEO_THUMBNAIL_MAX_BYTES,
  SEO_TAGS_MAX_CHARS,
  SEO_THUMBNAIL_MAX_WORDS,
  SEO_TITLE_MAX_CHARS,
  SEO_TITLE_RECOMMENDED_MAX_CHARS,
  normalizeHashtags,
  type SeoPackage,
} from './seo';

type TimingProject = Pick<ProjectDetail, 'chapters' | 'scenes' | 'renderSettings'>;
type DescriptionProject = TimingProject & Pick<ProjectDetail, 'referencesText' | 'language' | 'channelId'>;
type DescriptionSeo = Pick<SeoPackage, 'descriptionIntro' | 'hashtags' | 'tags'> & Partial<Pick<SeoPackage, 'descriptionKeywords'>>;

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

export function mergeChannelHashtags(aiHashtags: readonly string[], channelDefaults: readonly string[], tags: readonly string[] = []): string[] {
  const leadingAi = aiHashtags.slice(0, SEO_HASHTAGS_VISIBLE_COUNT);
  const remainingAi = aiHashtags.slice(SEO_HASHTAGS_VISIBLE_COUNT);
  const ordered = [...leadingAi, ...channelDefaults, ...remainingAi];
  return normalizeHashtags(ordered, tags).slice(0, SEO_HASHTAGS_MAX_COUNT);
}

export type DescriptionTrimmedBlock = 'sources' | 'keywords';
export type AssembledDescription = { text: string; trimmed: DescriptionTrimmedBlock[]; overLimit: boolean };

function sectionText(value: string | undefined): string {
  return value?.trim() ?? '';
}

function sourceBlock(project: DescriptionProject): string {
  const sources = parseSourceReferences(project.referencesText);
  if (sources.length === 0) return '';
  const heading = project.language === 'vi' ? 'Nguồn tham khảo:' : 'Sources:';
  return [heading, ...sources.map(({ title, url }, index) => `${index + 1}. ${title ? `${title}: ` : ''}${url}`)].join('\n');
}

function channelBlocks(project: DescriptionProject, channel?: Channel): { links: string; footer: string; disclosure: string } {
  const assignedChannel = channel && project.channelId === channel.id ? channel : undefined;
  return {
    links: assignedChannel?.links.map(({ label, url }) => `${label}: ${url}`).join('\n') ?? '',
    footer: sectionText(assignedChannel?.descriptionFooter),
    disclosure: sectionText(assignedChannel?.aiDisclosureText),
  };
}

export function assembleDescriptionDetailed(seo: DescriptionSeo, project: DescriptionProject, channel?: Channel): AssembledDescription {
  const intro = sectionText(seo.descriptionIntro);
  const keywords = sectionText(seo.descriptionKeywords);
  const chapters = chapterTimestamps(project);
  const chapterBlock = chapters.ok
    ? ['Mốc chương:', ...chapters.timestamps.map((chapter) => `${chapter.timestamp} ${chapter.title}`)].join('\n')
    : '';
  const sources = sourceBlock(project);
  const channelContent = channelBlocks(project, channel);
  const hashtags = normalizeHashtags(seo.hashtags, seo.tags).slice(0, SEO_HASHTAGS_MAX_COUNT).join(' ');
  const compose = (includeSources: boolean, includeKeywords: boolean) => [
    intro,
    includeKeywords ? keywords : '',
    chapterBlock,
    includeSources ? sources : '',
    channelContent.links,
    channelContent.footer,
    channelContent.disclosure,
    hashtags,
  ].filter(Boolean).join('\n\n');

  let includeSources = true;
  let includeKeywords = true;
  let text = compose(includeSources, includeKeywords);
  const trimmed: DescriptionTrimmedBlock[] = [];
  if (text.length > SEO_DESCRIPTION_MAX_CHARS && sources) {
    includeSources = false;
    trimmed.push('sources');
    text = compose(includeSources, includeKeywords);
  }
  if (text.length > SEO_DESCRIPTION_MAX_CHARS && keywords) {
    includeKeywords = false;
    trimmed.push('keywords');
    text = compose(includeSources, includeKeywords);
  }
  return { text, trimmed, overLimit: text.length > SEO_DESCRIPTION_MAX_CHARS };
}

export function assembleDescription(seo: DescriptionSeo, project: DescriptionProject, channel?: Channel): string {
  return assembleDescriptionDetailed(seo, project, channel).text;
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

export type PublishChecklistKey = 'title' | 'description' | 'tags' | 'hashtag' | 'pinnedComment' | 'thumbnail' | 'chapter-timestamps' | 'video' | 'channel' | 'sources' | 'ai-content' | 'description-length' | 'schedule' | 'duplicate-title' | 'shorts';
export type PublishChecklistItem = { key: PublishChecklistKey; label: string; done: boolean; detail: string; warning?: boolean; reminder?: true };
export type PublishThumbnailFile = { id: string; mimeType: string; sizeBytes: number };
export type PublishPackageContext = { now?: Date; otherChannelTitles?: readonly string[] };

export function substituteLongVideoUrl(text: string, url: string): string {
  return url ? text.split('{LONG_VIDEO_URL}').join(url) : text;
}

/** Build the warn-only publish checklist from the project package and optional file metadata. */
export function buildPublishChecklist(project: ProjectDetail, thumbnailFile?: PublishThumbnailFile, channel?: Channel, context?: PublishPackageContext): PublishChecklistItem[] {
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
  const description = assembleDescriptionDetailed(seo, project, channel);
  const parsedSources = parseSourceReferences(project.referencesText);
  const hasAssignedChannel = Boolean(channel && channel.id === project.channelId);
  const hasDescriptionIntro = seo.descriptionIntro.trim().length > 0;
  const assignedChannel = hasAssignedChannel ? channel : undefined;
  const schedule = assignedChannel?.publishSchedule;
  const hasLongSchedule = Boolean(schedule?.slots.some((slot) => slot.kind === 'long'));
  const nearestLongSlot = schedule && context?.now
    ? nextPublishSlots(schedule, context.now, 'long', 1)[0]
    : undefined;
  const scheduleDetail = !assignedChannel || !schedule
    ? 'Kênh chưa có lịch đăng; đặt lịch trong Quản lý kênh nếu muốn.'
    : !hasLongSchedule
      ? 'Lịch hiện tại chưa có khung giờ cho video dài.'
      : nearestLongSlot
        ? `Slot gần nhất: ${formatSlotLabel(nearestLongSlot, schedule.timezone)} (${schedule.timezone}).`
        : 'Kênh đã có lịch đăng; thời điểm gần nhất chưa được tính.';
  const duplicateTitles = title && context?.otherChannelTitles !== undefined
    ? findDuplicateTitle(title.text, context.otherChannelTitles)
    : null;
  const shortsWindows = pickShortsWindows(project);
  const shortsStale = seo.shorts.length > 0 && !sameShortsWindowFields(seo.shorts, shortsWindows.windows);
  const unresolvedLongVideoUrl = !seo.longVideoUrl && seo.shorts.some((short) => short.caption.includes('{LONG_VIDEO_URL}'));
  const shortsDetail = shortsWindows.windows.length === 0
    ? 'Video không có đoạn 30–55 giây phù hợp.'
    : shortsStale
      ? 'Mốc cắt có thể đã cũ; hãy tạo lại gói Shorts.'
      : unresolvedLongVideoUrl
        ? 'Caption còn placeholder {LONG_VIDEO_URL}; nhập URL video dài để thay thế khi xuất hoặc sao chép.'
        : seo.shorts.length > 0
          ? 'Gói Shorts đã có nội dung cho các mốc cắt hiện tại.'
          : 'Có thể tạo gói Shorts từ các mốc cắt gợi ý.';
  return [
    ...(chapterWarnings.length > 0 ? [{ key: 'chapter-timestamps' as const, label: 'M\u1ed1c ch\u01b0\u01a1ng', done: true, warning: true, detail: chapterWarnings.join(' ') }] : []),
    { key: 'title', label: 'Đã chọn tiêu đề', done: Boolean(title && titleStatus(title.text).length <= SEO_TITLE_MAX_CHARS), detail: title?.text ?? 'Chưa chọn tiêu đề.' },
    { key: 'description', label: 'Có mô tả', done: hasDescriptionIntro, detail: hasDescriptionIntro ? 'Mô tả đã có phần mở đầu.' : 'Chưa có phần mở đầu mô tả.' },
    { key: 'tags', label: 'Tags trong ngân sách', done: !tags.overLimit && seo.tags.length > 0, detail: `${tags.used}/${tags.max} ký tự.` },
    { key: 'hashtag', label: 'Có hashtag', done: hashtags.ok && hashtags.count > 0, detail: `${hashtags.count}/${hashtags.max} hashtag.` },
    { key: 'pinnedComment', label: 'Có bình luận ghim', done: seo.pinnedComment.trim().length > 0, detail: seo.pinnedComment.trim() ? 'Đã có bình luận.' : 'Chưa có bình luận.' },
    { key: 'thumbnail', label: 'Thumbnail hợp lệ', done: thumbnailOk, detail: thumbnailOk ? 'PNG/JPEG, trong giới hạn.' : 'Cần thumbnail PNG/JPEG không quá 2 MB.' },
    { key: 'video', label: 'Video đã render', done: Boolean(project.renderFileId), detail: project.renderFileId ? 'Đã có file render.' : 'Chưa render video cuối.' },
    { key: 'channel', label: 'Đã chọn kênh', done: hasAssignedChannel, warning: !hasAssignedChannel, detail: hasAssignedChannel ? channel!.name : 'Chưa gán kênh cho dự án.' },
    { key: 'schedule', label: 'Lịch đăng gợi ý', done: false, reminder: true, detail: scheduleDetail },
    ...(duplicateTitles === null ? [] : [{
      key: 'duplicate-title' as const,
      label: 'Tiêu đề trên cùng kênh',
      done: duplicateTitles.length === 0,
      warning: duplicateTitles.length > 0,
      detail: duplicateTitles.length > 0 ? `Tiêu đề trùng hoặc gần giống: ${duplicateTitles.join(' · ')}` : 'Không trùng tiêu đề đã chọn trên kênh này.',
    }]),
    {
      key: 'shorts',
      label: 'Gói Shorts',
      done: shortsWindows.windows.length === 0 || seo.shorts.length > 0,
      ...(seo.shorts.length === 0 && shortsWindows.windows.length > 0 ? { reminder: true as const } : {}),
      ...(shortsStale || unresolvedLongVideoUrl ? { warning: true } : {}),
      detail: shortsDetail,
    },
    { key: 'sources', label: 'Nguồn tham khảo', done: parsedSources.length > 0 && !description.trimmed.includes('sources'), warning: parsedSources.length === 0, detail: parsedSources.length > 0 ? `${parsedSources.length} nguồn có URL hợp lệ.` : 'referencesText chưa có URL HTTP/HTTPS nào trong dòng nguồn có số thứ tự.' },
    { key: 'ai-content', label: 'Khai báo nội dung AI/tổng hợp', done: false, reminder: true, detail: 'Trả lời câu hỏi nội dung bị thay đổi/tổng hợp trong bước tải lên của YouTube nếu video có cảnh hoặc giọng thật được tạo bằng AI. Đây là quy tắc của YouTube; bạn tự quyết định theo nội dung video.' },
    ...(description.trimmed.length > 0 || description.overLimit ? [{ key: 'description-length' as const, label: 'Độ dài mô tả', done: false, warning: true, detail: description.overLimit ? 'Mô tả vẫn vượt giới hạn sau khi bỏ các khối nguồn và từ khóa có thể cắt.' : `Đã bỏ khối ${description.trimmed.join(' rồi ')} để giữ mô tả trong giới hạn.` }] : []),
  ];
}

export function buildPackageMarkdown(project: ProjectDetail, channel?: Channel, context?: PublishPackageContext): string {
  const seo = project.seo;
  const title = seo.titles.find((item) => item.id === seo.chosenTitleId)?.text ?? '';
  const idea = seo.thumbnail.ideas.find((item) => item.id === seo.thumbnail.chosenIdeaId);
  const hashtags = normalizeHashtags(seo.hashtags, seo.tags);
  const assignedChannel = channel && project.channelId === channel.id ? channel : undefined;
  const channelSection = assignedChannel
    ? [`## Kênh\n${assignedChannel.name}${assignedChannel.handle ? `\n${assignedChannel.handle}` : ''}${assignedChannel.links.length ? `\n${assignedChannel.links.map(({ label, url }) => `${label}: ${url}`).join('\n')}` : ''}`]
    : [];
  const schedule = assignedChannel?.publishSchedule;
  const nextSlots = schedule && context?.now
    ? nextPublishSlots(schedule, context.now, 'long', 3)
    : [];
  const scheduleSection = schedule && nextSlots.length > 0
    ? [[
      `## Lịch đăng gợi ý\nMúi giờ: ${schedule.timezone}`,
      ...nextSlots.map((slot, index) => `${index + 1}. ${formatSlotLabel(slot, schedule.timezone)}`),
      `gợi ý, chưa kiểm chứng: tải video lên ở chế độ không công khai hoặc đặt lịch trước khoảng ${PUBLISH_LEAD_HOURS_MIN}–${PUBLISH_LEAD_HOURS_MAX} giờ để YouTube xử lý và kiểm tra bản quyền xong.`,
    ].join('\n')]
    : [];
  const shortsSection = seo.shorts.length > 0
    ? [[
      '## Gói Shorts',
      ...seo.shorts.flatMap((short, index) => [
        `${index + 1}. ${formatTimestamp(short.startSec)}–${formatTimestamp(short.endSec)} · Chương ${short.chapterNo}`,
        `Hook: ${short.hookLine}`,
        `Tiêu đề: ${short.title}`,
        `Caption: ${substituteLongVideoUrl(short.caption, seo.longVideoUrl)}`,
        `Hashtags: ${short.hashtags.join(' ')}`,
        `Lý do: ${short.reason}`,
      ]),
      'Cắt và dựng video dọc thực hiện thủ công.',
    ].join('\n')]
    : [];
  return [
    ['# Gói đăng YouTube', `Ngày tạo gói: ${project.updatedAt}`].join('\n'),
    ...channelSection,
    ...scheduleSection,
    ['## Tiêu đề', title || '(chưa chọn)'].join('\n'),
    ['## Mô tả', assembleDescription(seo, project, assignedChannel)].join('\n'),
    ['## Tags', seo.tags.join(', ')].join('\n'),
    ['## Hashtag', hashtags.join(' ')].join('\n'),
    ['## Bình luận ghim', seo.pinnedComment].join('\n'),
    ...shortsSection,
    ['## Thumbnail', idea ? `Chữ: ${idea.overlayText}\nConcept: ${idea.concept}\nPrompt ảnh: ${idea.imagePrompt}` : '(chưa chọn ý tưởng)'].join('\n'),
  ].join('\n\n') + '\n';
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
