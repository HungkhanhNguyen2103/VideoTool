import type { ProjectDetail } from '../../../../contracts/project';
import type { Channel } from '../../../../contracts/channel';
import { z } from 'zod';
import { SEO_DESCRIPTION_KEYWORDS_MAX_CHARS, SEO_DESCRIPTION_KEYWORDS_MAX_WORDS, SEO_DESCRIPTION_KEYWORDS_MIN_WORDS, SEO_DESCRIPTION_MAX_CHARS, SEO_HASHTAGS_MAX_COUNT, SEO_SECTIONS, SEO_SHORTS_CAPTION_MAX_CHARS, SEO_SHORTS_HASHTAGS_MAX_COUNT, SEO_SHORTS_TITLE_MAX_CHARS, SEO_TAGS_MAX_CHARS, SEO_THUMBNAIL_MAX_WORDS, SEO_TITLE_MAX_CHARS, SEO_TITLE_RECOMMENDED_MAX_CHARS, type SeoSection } from '../../../../contracts/seo';
import type { ShortsWindow } from '../../../../contracts/seo-shorts';
import { loadSeoPreset, loadSeoShortsPreset } from './presets/loader';
import { SeoAiOutputSchema, SeoAiShortsOutputSchema } from './output-schema';
import { activeScenes } from '../../../../contracts/scene-active';

export type SeoBuiltPrompt = { system: string; user: string; jsonSchema: Record<string, unknown>; promptVersion: string };

function language(project: ProjectDetail): string {
  return project.language === 'vi' ? 'Vietnamese' : 'English';
}

function selectedSections(sections: readonly SeoSection[]): SeoSection[] {
  return [...new Set(sections.length > 0 ? sections : SEO_SECTIONS)].filter((section) => section !== 'shorts');
}

function openingExcerpt(project: ProjectDetail): string {
  const opening = activeScenes(project.scenes)[0]?.narration.trim() ?? '';
  return opening.slice(0, 1000) || '(none)';
}

function totalDuration(project: ProjectDetail): number {
  return activeScenes(project.scenes).reduce((sum, scene) => sum + scene.durationSec, 0);
}

export function buildSeoPrompt(project: ProjectDetail, sections: readonly SeoSection[] = SEO_SECTIONS, channel?: Channel): SeoBuiltPrompt {
  const preset = loadSeoPreset();
  const requested = selectedSections(sections);
  const assignedChannel = channel && project.channelId === channel.id ? channel : undefined;
  const chosenTitle = project.seo.titles.find((title) => title.id === project.seo.chosenTitleId)?.text ?? '(none)';
  const jsonSchema = zodJsonSchema();
  const thumbnailTemplate = assignedChannel?.thumbnailTemplate?.trim() || preset.thumbnailTemplate;
  const instructions = preset.instructions.replace('[[THUMBNAIL_TEMPLATE]]', () => thumbnailTemplate);
  const channelBlock = assignedChannel ? [
    'Channel:',
    `Name: ${assignedChannel.name}`,
    `Handle: ${assignedChannel.handle ?? '(none)'}`,
    `Tagline: ${assignedChannel.tagline || '(none)'}`,
    `Language: ${assignedChannel.language}`,
    `Default hashtags: ${JSON.stringify(assignedChannel.defaultHashtags)}`,
  ].join('\n') : '';
  return {
    system: [
      'Return one strict JSON object only. Do not use markdown fences or prose outside JSON.',
      `Generate only these requested sections: ${requested.join(', ')}. Do not invent facts, figures, dates, quotes, motives, or chapter timestamps not present in the supplied data.`,
      `Titles: provide up to five options, cover the requested angle enum values when possible, keep each at most ${SEO_TITLE_MAX_CHARS} characters and prefer ${SEO_TITLE_RECOMMENDED_MAX_CHARS} or fewer.`,
      `Description intro: at most ${SEO_DESCRIPTION_MAX_CHARS} characters. Description keywords: one natural paragraph of ${SEO_DESCRIPTION_KEYWORDS_MIN_WORDS}–${SEO_DESCRIPTION_KEYWORDS_MAX_WORDS} words and at most ${SEO_DESCRIPTION_KEYWORDS_MAX_CHARS} characters. Tags must be specific-to-broad and together use at most ${SEO_TAGS_MAX_CHARS} characters.`,
      `Hashtags: at most ${SEO_HASHTAGS_MAX_COUNT}; each starts with #, has no spaces, uses CamelCase and prefers unaccented spelling; put the three most relevant first and do not repeat tags.`,
      `Thumbnail overlay text: at most ${SEO_THUMBNAIL_MAX_WORDS} words; imagePrompt is an English, paste-ready image-generator prompt that includes the exact overlay text to render on the image.`,
      preset.system,
      instructions,
    ].join('\n\n'),
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `Language: ${language(project)}`,
      `Core question: ${project.coreQuestion || '(none)'}`,
      `Opening hook: ${project.openingHook || '(none)'}`,
      `Motif: ${project.motif ? JSON.stringify(project.motif) : '(none)'}`,
      `Duration seconds: ${totalDuration(project)}`,
      `Chapters: ${JSON.stringify(project.chapters.map((chapter) => ({ no: chapter.no, title: chapter.title, role: chapter.role, chapterSummary: chapter.chapterSummary })))}`,
      `Opening excerpt of chapter 1: ${openingExcerpt(project)}`,
      `Chosen title context: ${chosenTitle}`,
      `Requested sections: ${requested.join(', ')}`,
      ...(channelBlock ? [channelBlock] : []),
      `Return JSON matching this schema: ${JSON.stringify(jsonSchema)}`,
    ].join('\n\n'),
    jsonSchema,
    promptVersion: `seo-prompt-v1/${preset.id}@${preset.version}`,
  };
}

export const SEO_SHORTS_PROMPT_VERSION = 'seo-shorts-prompt-v1/seo-shorts@1';

export function buildShortsPrompt(project: ProjectDetail, windows: readonly ShortsWindow[], channel?: Channel): SeoBuiltPrompt {
  const preset = loadSeoShortsPreset();
  const assignedChannel = channel && project.channelId === channel.id ? channel : undefined;
  const channelBlock = assignedChannel ? [
    'Channel:',
    `Name: ${assignedChannel.name}`,
    `Handle: ${assignedChannel.handle ?? '(none)'}`,
    `Language: ${assignedChannel.language}`,
    `Default hashtags: ${JSON.stringify(assignedChannel.defaultHashtags)}`,
  ].join('\n') : '';
  const windowsText = windows.map((window) => {
    const chapter = project.chapters.find((candidate) => candidate.no === window.chapterNo);
    const narration = window.sceneIds
      .map((id) => project.scenes.find((scene) => scene.id === id && scene.active !== false)?.narration ?? '')
      .filter(Boolean)
      .join('\n')
      .slice(0, 1200);
    return [
      `window_id: ${window.id}`,
      `chapter title: ${chapter?.title ?? '(unknown)'}`,
      `duration: ${Number((window.endSec - window.startSec).toFixed(2))} seconds`,
      `narration excerpt: ${narration || '(none)'}`,
    ].join('\n');
  });
  const jsonSchema = z.toJSONSchema(SeoAiShortsOutputSchema) as Record<string, unknown>;
  return {
    system: [
      'Return one strict JSON object only. Do not use markdown fences or prose outside JSON.',
      `Write exactly one Shorts entry for each supplied window ID. Do not add, change, or repeat IDs. Title limit: ${SEO_SHORTS_TITLE_MAX_CHARS}; caption limit: ${SEO_SHORTS_CAPTION_MAX_CHARS}; use no more than ${SEO_SHORTS_HASHTAGS_MAX_COUNT} hashtags including #Shorts.`,
      'The opening hook should work in the first 2 seconds. Do not invent facts, figures, names, dates, quotes, motives, or events absent from that window narration excerpt. Do not include timecodes.',
      preset.system,
      preset.instructions,
    ].join('\n\n'),
    user: [
      `Language: ${language(project)}`,
      ...(windowsText.length > 0 ? windowsText : ['No eligible windows. Return {"shorts": []}.']),
      ...(channelBlock ? [channelBlock] : []),
      `Return JSON matching this schema: ${JSON.stringify(jsonSchema)}`,
    ].join('\n\n'),
    jsonSchema,
    promptVersion: `seo-shorts-prompt-v1/${preset.id}@${preset.version}`,
  };
}

function zodJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SeoAiOutputSchema) as Record<string, unknown>;
}
