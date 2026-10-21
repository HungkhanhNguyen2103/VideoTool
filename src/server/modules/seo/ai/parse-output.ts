import { z } from 'zod';
import { SEO_DESCRIPTION_KEYWORDS_MAX_CHARS, SEO_DESCRIPTION_MAX_CHARS, SEO_HASHTAGS_MAX_COUNT, SEO_TITLE_MAX_CHARS, normalizeHashtags, type GeneratedSeoSections, type SeoSection } from '../../../../contracts/seo';
import { AppError } from '../../../shared/errors';
import { SeoAiOutputSchema, type SeoAiOutput } from './output-schema';

export class SeoAiOutputError extends AppError {
  constructor(detail: string) {
    super(`SEO AI output invalid: ${detail}`, 502, 'SEO_AI_OUTPUT_INVALID');
  }
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    throw new SeoAiOutputError('root: invalid JSON');
  }
}

function describeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : 'root'}: ${issue.message}`)
    .join('; ');
}

function requireSection(output: SeoAiOutput, section: SeoSection): void {
  const present = section === 'titles' ? output.titles !== undefined
    : section === 'description' ? output.description_intro !== undefined
      : section === 'tags' ? output.tags !== undefined && output.hashtags !== undefined
        : section === 'pinnedComment' ? output.pinned_comment !== undefined
          : output.thumbnail !== undefined;
  if (!present) throw new SeoAiOutputError(`root: missing requested section ${section}`);
}

function uniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags.map((tag) => tag.trim()).filter(Boolean).filter((tag) => {
    const key = tag.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeOutput(output: SeoAiOutput, sections: readonly SeoSection[]): Omit<GeneratedSeoSections, 'generatedBy'> {
  const requested = new Set(sections);
  const result: Partial<Omit<GeneratedSeoSections, 'generatedBy'>> = {};
  if (requested.has('titles')) {
    result.titles = output.titles!.slice(0, 5).map((title, index) => ({ id: `title-${index + 1}`, text: title.text.trim().slice(0, SEO_TITLE_MAX_CHARS), angle: title.angle })).filter((title) => title.text.length > 0);
  }
  if (requested.has('description')) {
    result.descriptionIntro = output.description_intro!.trim().slice(0, SEO_DESCRIPTION_MAX_CHARS);
    if (output.description_keywords !== undefined) {
      result.descriptionKeywords = output.description_keywords.trim().slice(0, SEO_DESCRIPTION_KEYWORDS_MAX_CHARS);
    }
  }
  if (requested.has('tags')) {
    result.tags = uniqueTags(output.tags!);
    const candidates = output.hashtags!.filter((hashtag) => /^#[^\s]+$/.test(hashtag.trim())).slice(0, SEO_HASHTAGS_MAX_COUNT);
    result.hashtags = normalizeHashtags(candidates, result.tags);
  }
  if (requested.has('pinnedComment')) result.pinnedComment = output.pinned_comment!.trim();
  if (requested.has('thumbnail')) {
    result.thumbnail = {
      ideas: output.thumbnail!.ideas.slice(0, 3).map((idea, index) => ({
        id: `idea-${index + 1}`,
        overlayText: idea.overlay_text.trim().slice(0, 200),
        concept: idea.concept.trim(),
        imagePrompt: idea.image_prompt.trim(),
      })).filter((idea) => idea.overlayText.length > 0 && idea.concept.length > 0 && idea.imagePrompt.length > 0),
      chosenIdeaId: null,
      fileId: null,
    };
  }
  return result as Omit<GeneratedSeoSections, 'generatedBy'>;
}

export function parseSeoOutput(raw: string, sections: readonly SeoSection[]): Omit<GeneratedSeoSections, 'generatedBy'> {
  const value = parseJson(raw);
  const parsed = SeoAiOutputSchema.safeParse(value);
  if (!parsed.success) throw new SeoAiOutputError(describeZodError(parsed.error));
  const requested = [...new Set(sections)];
  for (const section of requested) requireSection(parsed.data, section);
  return normalizeOutput(parsed.data, requested);
}
