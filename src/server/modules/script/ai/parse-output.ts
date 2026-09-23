import { z } from 'zod';
import { AppError } from '../../../shared/errors';
import { GeneratedChapterSchema, RegeneratedParagraphsSchema, VisualPromptBatchSchema } from './output-schema';

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
  if (!result.success) throw new AppError('AI returned invalid script structure.', 422, 'SCRIPT_PARSE_ERROR');
  return result.data;
}

export function parseGeneratedChapters(raw: string): z.infer<typeof GeneratedChapterSchema>[] {
  return validate(raw, z.array(GeneratedChapterSchema).min(1));
}

export function parseRegeneratedParagraphs(raw: string): string[] {
  return validate(raw, RegeneratedParagraphsSchema);
}

export function parseVisualPromptBatch(raw: string): z.infer<typeof VisualPromptBatchSchema> {
  return validate(raw, VisualPromptBatchSchema);
}
