import { z } from 'zod';
import { AppError } from '../../../shared/errors';
import { ChapterExpansionSchema, GeneratedChapterSchema, manualSchemaForScriptPreset, RegeneratedParagraphsSchema, schemaForScriptPreset, SceneSplitBatchSchema, VisualPromptBatchSchema, type ChapterExpansion, type ManualScriptDocument, type ScriptOutline } from './output-schema';
import { QAIssueOptionalFieldSchemas, QAResultSchema, type QAResult } from './qa-schema';
import type { ScriptPresetId } from '../../../../contracts/project';

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    throw new AppError('AI returned invalid script structure: root: invalid JSON', 422, 'SCRIPT_PARSE_ERROR');
  }
}

export type ManualParseKind = 'script' | 'chapter' | 'qa';

const manualParseKindLabel: Record<ManualParseKind, string> = {
  script: 'bản thảo kịch bản',
  chapter: 'chương',
  qa: 'kết quả QA',
};

export function translateManualParseError(error: unknown, kind: ManualParseKind): never {
  if (!(error instanceof AppError)) throw error;
  if (kind === 'script' && error.message === 'AI returned an invalid chapter count.') {
    throw new AppError('Số chương trong bản thảo không khớp với số chương đã chọn cho dự án.', error.status, error.code);
  }
  if (error.code !== 'SCRIPT_PARSE_ERROR') throw error;

  const detail = error.message.startsWith('AI returned invalid script structure: ')
    ? error.message.slice('AI returned invalid script structure: '.length)
    : error.message;
  if (detail === 'root: invalid JSON') {
    throw new AppError(
      `JSON của ${manualParseKindLabel[kind]} không hợp lệ. Hãy dán nguyên văn JSON do AI trả về, không kèm chữ giải thích bên ngoài; kiểm tra dấu ngoặc và dấu phẩy.`,
      error.status,
      error.code,
    );
  }
  throw new AppError(
    `JSON của ${manualParseKindLabel[kind]} thiếu hoặc sai trường: ${detail}${detail.endsWith('.') ? '' : '.'}`,
    error.status,
    error.code,
  );
}

type TruncationNotice = (message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateAtWordBoundary(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const candidate = value.slice(0, limit);
  const boundary = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\t'), candidate.lastIndexOf('\n'), candidate.lastIndexOf('\r'));
  return candidate.slice(0, boundary > 0 ? boundary : limit).trimEnd();
}

function truncateMemoryString(value: string, field: string, limit: number, onTruncate?: TruncationNotice): string {
  if (value.length <= limit) return value;
  onTruncate?.(`Truncated ${field} from ${value.length} to ${limit} chars`);
  return truncateAtWordBoundary(value, limit);
}

function normalizeMemoryArray(value: unknown, field: string, itemLimit: number, onTruncate?: TruncationNotice): unknown {
  if (!Array.isArray(value)) return value;
  const limited = value.length > 5 ? value.slice(0, 5) : value;
  if (value.length > 5) onTruncate?.(`Truncated ${field} from ${value.length} to 5 items`);
  return limited.map((item, index) => typeof item === 'string'
    ? truncateMemoryString(item, `${field}[${index}]`, itemLimit, onTruncate)
    : item);
}

function normalizeMemoryFields(value: unknown, onTruncate?: TruncationNotice): unknown {
  if (!isRecord(value)) return value;
  const normalized = { ...value };
  if (typeof normalized.styleNote === 'string') {
    normalized.styleNote = truncateMemoryString(normalized.styleNote.trim(), 'styleNote', 500, onTruncate);
  }
  if (typeof normalized.chapterSummary === 'string') {
    normalized.chapterSummary = truncateMemoryString(normalized.chapterSummary, 'chapterSummary', 250, onTruncate);
  }
  if ('avoidRepeating' in normalized) {
    normalized.avoidRepeating = normalizeMemoryArray(normalized.avoidRepeating, 'avoidRepeating', 80, onTruncate);
  }
  if ('persistentFactsNext' in normalized) {
    normalized.persistentFactsNext = normalizeMemoryArray(normalized.persistentFactsNext, 'persistentFactsNext', 120, onTruncate);
  }
  return normalized;
}

function sanitizeQaOptionalFields(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.issues)) return value;
  return {
    ...value,
    issues: value.issues.map((issue) => {
      if (!isRecord(issue)) return issue;
      const normalized = { ...issue };
      for (const field of Object.keys(QAIssueOptionalFieldSchemas) as Array<keyof typeof QAIssueOptionalFieldSchemas>) {
        if (!(field in normalized)) continue;
        const parsed = QAIssueOptionalFieldSchemas[field].safeParse(normalized[field]);
        if (parsed.success) normalized[field] = parsed.data;
        else delete normalized[field];
      }
      return normalized;
    }),
  };
}

function dropStrayOutlineKeys(value: unknown, presetId: ScriptPresetId): unknown {
  if (presetId === 'hubris-trap' || !isRecord(value)) return value;
  const normalized = { ...value };
  delete normalized.motif;
  delete normalized.outline;
  delete normalized.motifNote;
  return normalized;
}

function validateValue<T>(value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.length ? issue.path.join('.') : 'root'}: ${issue.message}`)
      .join('; ');
    throw new AppError(`AI returned invalid script structure: ${issues}`, 422, 'SCRIPT_PARSE_ERROR');
  }
  return result.data;
}

function validate<T>(raw: string, schema: z.ZodType<T>): T {
  return validateValue(parseJson(raw), schema);
}

export function parseGeneratedChapters(raw: string): z.infer<typeof GeneratedChapterSchema>[] {
  return validate(raw, z.array(GeneratedChapterSchema).min(1));
}

export function parseScriptOutline(raw: string, presetId: ScriptPresetId): ScriptOutline {
  return validateValue(dropStrayOutlineKeys(parseJson(raw), presetId), schemaForScriptPreset(presetId));
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

export function parseChapterExpansion(raw: string, onTruncate?: TruncationNotice): ChapterExpansion {
  return validateValue(normalizeMemoryFields(parseJson(raw), onTruncate), ChapterExpansionSchema);
}

export function parseManualScriptDocument(raw: string, presetId: ScriptPresetId): ManualScriptDocument {
  return validate(raw, manualSchemaForScriptPreset(presetId));
}

export function parseRegeneratedParagraphs(raw: string, onTruncate?: TruncationNotice): z.infer<typeof RegeneratedParagraphsSchema> {
  return validateValue(normalizeMemoryFields(parseJson(raw), onTruncate), RegeneratedParagraphsSchema);
}

export function parseVisualPromptBatch(raw: string): z.infer<typeof VisualPromptBatchSchema> {
  return validate(raw, VisualPromptBatchSchema);
}

export function parseSceneSplitBatch(raw: string): z.infer<typeof SceneSplitBatchSchema> {
  return validate(raw, SceneSplitBatchSchema);
}

export function parseQaResult(raw: string): QAResult {
  return validateValue(sanitizeQaOptionalFields(parseJson(raw)), QAResultSchema);
}
