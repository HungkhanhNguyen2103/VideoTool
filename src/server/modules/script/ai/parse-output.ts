import { z } from 'zod';
import { AppError } from '../../../shared/errors';
import { ChapterExpansionSchema, GeneratedChapterSchema, manualSchemaForScriptPreset, RegeneratedParagraphsSchema, schemaForScriptPreset, SceneSplitBatchSchema, VisualPromptBatchSchema, type ChapterExpansion, type ManualScriptDocument, type ScriptOutline } from './output-schema';
import { QAResultSchema, type QAResult } from './qa-schema';
import type { ScriptPresetId } from '../../../../contracts/project';

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    throw new AppError('AI returned invalid script structure.', 422, 'SCRIPT_PARSE_ERROR');
  }
}

function validate<T>(raw: string, schema: z.ZodType<T>): T {
  const result = schema.safeParse(parseJson(raw));
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.length ? issue.path.join('.') : 'root'}: ${issue.message}`)
      .join('; ');
    throw new AppError(`AI returned invalid script structure: ${issues}`, 422, 'SCRIPT_PARSE_ERROR');
  }
  return result.data;
}

export function parseGeneratedChapters(raw: string): z.infer<typeof GeneratedChapterSchema>[] {
  return validate(raw, z.array(GeneratedChapterSchema).min(1));
}

export function parseScriptOutline(raw: string, presetId: ScriptPresetId): ScriptOutline {
  return validate(raw, schemaForScriptPreset(presetId));
}

export function validateScriptOutlineChapterCount<T extends { chapters: readonly unknown[] }>(
  outline: T,
  requestedChapterCount: number | null,
): T {
  const count = outline.chapters.length;
  const valid = requestedChapterCount === null ? count >= 1 && count <= 20 : count === requestedChapterCount;
  if (!valid) throw new AppError('AI returned an invalid chapter count.', 422, 'SCRIPT_PARSE_ERROR');
  return outline;
}

export function parseChapterExpansion(raw: string): ChapterExpansion {
  return validate(raw, ChapterExpansionSchema);
}

export function parseManualScriptDocument(raw: string, presetId: ScriptPresetId): ManualScriptDocument {
  return validate(raw, manualSchemaForScriptPreset(presetId));
}

export function parseRegeneratedParagraphs(raw: string): z.infer<typeof RegeneratedParagraphsSchema> {
  return validate(raw, RegeneratedParagraphsSchema);
}

export function parseVisualPromptBatch(raw: string): z.infer<typeof VisualPromptBatchSchema> {
  return validate(raw, VisualPromptBatchSchema);
}

export function parseSceneSplitBatch(raw: string): z.infer<typeof SceneSplitBatchSchema> {
  return validate(raw, SceneSplitBatchSchema);
}

export function parseQaResult(raw: string): QAResult {
  return validate(raw, QAResultSchema);
}
