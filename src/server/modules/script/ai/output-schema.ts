import { z } from 'zod';
import { HubrisMotifSchema, NARRATIVE_ROLES, OpenLoopSchema } from '../../../../contracts/script';
import type { ScriptPresetId } from '../../../../contracts/project';

const OutlineChapterSchema = z.object({
  no: z.number().int().positive(),
  title: z.string().min(1),
  role: z.enum(NARRATIVE_ROLES),
  beat: z.string().min(1),
  targetWords: z.number().int().positive(),
  endsOnTension: z.boolean(),
}).strict();

const OutlineBaseSchema = z.object({
  chapters: z.array(OutlineChapterSchema).min(1),
  openLoops: z.array(OpenLoopSchema),
  coreQuestion: z.string().min(1),
  openingHook: z.string().min(1),
}).strict();

export const DocumentaryScriptOutlineSchema = OutlineBaseSchema;
export const HubrisScriptOutlineSchema = OutlineBaseSchema.extend({ motif: HubrisMotifSchema }).strict();

export const ScriptOutlineSchema = z.union([DocumentaryScriptOutlineSchema, HubrisScriptOutlineSchema]);
export type ScriptOutline = z.infer<typeof ScriptOutlineSchema>;
export type ScriptOutlineChapter = z.infer<typeof OutlineChapterSchema>;

export const ChapterExpansionSchema = z.object({
  paragraphs: z.array(z.string().min(1)).min(1),
  styleNote: z.string().max(500),
  chapterSummary: z.string().max(250),
  avoidRepeating: z.array(z.string().max(80)).max(5),
  persistentFactsNext: z.array(z.string().max(120)).max(5),
}).strict();
export type ChapterExpansion = z.infer<typeof ChapterExpansionSchema>;

const ManualChapterSchema = OutlineChapterSchema.extend({ paragraphs: z.array(z.string().min(1)).min(1) }).strict();
const ManualBaseSchema = z.object({
  chapters: z.array(ManualChapterSchema).min(1),
  openLoops: z.array(OpenLoopSchema),
  coreQuestion: z.string().min(1),
  openingHook: z.string().min(1),
}).strict();
export const DocumentaryManualScriptDocumentSchema = ManualBaseSchema;
export const HubrisManualScriptDocumentSchema = ManualBaseSchema.extend({ motif: HubrisMotifSchema }).strict();
export const ManualScriptDocumentSchema = z.union([DocumentaryManualScriptDocumentSchema, HubrisManualScriptDocumentSchema]);
export type ManualScriptDocument = z.infer<typeof ManualScriptDocumentSchema>;

export function schemaForScriptPreset(presetId: ScriptPresetId) {
  return presetId === 'hubris-trap' ? HubrisScriptOutlineSchema : DocumentaryScriptOutlineSchema;
}

export function manualSchemaForScriptPreset(presetId: ScriptPresetId) {
  return presetId === 'hubris-trap' ? HubrisManualScriptDocumentSchema : DocumentaryManualScriptDocumentSchema;
}

export const GeneratedChapterSchema = z.object({
  no: z.number().int().positive(),
  title: z.string(),
  paragraphs: z.array(z.string()).min(1),
  scenesCount: z.null(),
  durationSec: z.null(),
});

export const RegeneratedParagraphsSchema = z.object({
  paragraphs: z.array(z.string()).min(1),
  chapterSummary: z.string().max(250),
  avoidRepeating: z.array(z.string().max(80)).max(5),
  persistentFactsNext: z.array(z.string().max(120)).max(5),
}).strict();

export const VisualPromptBatchSchema = z.object({
  styleNote: z.string().max(500),
  prompts: z.array(z.object({
    sceneIndex: z.number().int().positive(),
    visualPrompt: z.string().trim().min(1),
    sfxPrompt: z.string().trim().max(120).default(''),
    motionPrompt: z.string().trim().max(400).default(''),
  })),
});

export const SceneSplitBatchSchema = z.object({
  scenes: z.array(z.object({
    sceneIndex: z.number().int().positive(),
    chunks: z.array(z.string().min(1)).min(1),
  })),
});
