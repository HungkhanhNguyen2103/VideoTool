import type { ProjectDetail } from '../../../../contracts/project';
import { z } from 'zod';
import { SEO_DESCRIPTION_MAX_CHARS, SEO_HASHTAGS_MAX_COUNT, SEO_SECTIONS, SEO_TAGS_MAX_CHARS, SEO_THUMBNAIL_MAX_WORDS, SEO_TITLE_MAX_CHARS, SEO_TITLE_RECOMMENDED_MAX_CHARS, type SeoSection } from '../../../../contracts/seo';
import { loadSeoPreset } from './presets/loader';
import { SeoAiOutputSchema } from './output-schema';
import { activeScenes } from '../../../../contracts/scene-active';

export type SeoBuiltPrompt = { system: string; user: string; jsonSchema: Record<string, unknown>; promptVersion: string };

function language(project: ProjectDetail): string {
  return project.language === 'vi' ? 'Vietnamese' : 'English';
}

function selectedSections(sections: readonly SeoSection[]): SeoSection[] {
  return [...new Set(sections.length > 0 ? sections : SEO_SECTIONS)];
}

function openingExcerpt(project: ProjectDetail): string {
  const opening = activeScenes(project.scenes)[0]?.narration.trim() ?? '';
  return opening.slice(0, 1000) || '(none)';
}

function totalDuration(project: ProjectDetail): number {
  return activeScenes(project.scenes).reduce((sum, scene) => sum + scene.durationSec, 0);
}

export function buildSeoPrompt(project: ProjectDetail, sections: readonly SeoSection[] = SEO_SECTIONS): SeoBuiltPrompt {
  const preset = loadSeoPreset();
  const requested = selectedSections(sections);
  const chosenTitle = project.seo.titles.find((title) => title.id === project.seo.chosenTitleId)?.text ?? '(none)';
  const jsonSchema = zodJsonSchema();
  return {
    system: [
      'Return one strict JSON object only. Do not use markdown fences or prose outside JSON.',
      `Generate only these requested sections: ${requested.join(', ')}. Do not invent facts, figures, dates, quotes, motives, or chapter timestamps not present in the supplied data.`,
      `Titles: provide up to five options, cover the requested angle enum values when possible, keep each at most ${SEO_TITLE_MAX_CHARS} characters and prefer ${SEO_TITLE_RECOMMENDED_MAX_CHARS} or fewer.`,
      `Description intro: at most ${SEO_DESCRIPTION_MAX_CHARS} characters. Tags must be specific-to-broad and together use at most ${SEO_TAGS_MAX_CHARS} characters.`,
      `Hashtags: at most ${SEO_HASHTAGS_MAX_COUNT}; each starts with #, has no spaces, uses CamelCase and prefers unaccented spelling; put the three most relevant first and do not repeat tags.`,
      `Thumbnail overlay text: at most ${SEO_THUMBNAIL_MAX_WORDS} words; imagePrompt must describe an English visual concept, not embedded readable text.`,
      preset.system,
      preset.instructions,
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
      `Return JSON matching this schema: ${JSON.stringify(jsonSchema)}`,
    ].join('\n\n'),
    jsonSchema,
    promptVersion: `seo-prompt-v1/${preset.id}@${preset.version}`,
  };
}

function zodJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SeoAiOutputSchema) as Record<string, unknown>;
}
