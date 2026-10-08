import { Router } from 'express';
import { z } from 'zod';
import { VISUAL_STYLE_IDS } from '../../../contracts/project';
import { getProject, setProjectAiProvider, setProjectVisualStylePreset } from '../project';
import { AppError } from '../../shared/errors';
import { buildManualScriptPrompt, buildQaPrompt } from './ai/build-prompt';
import { parseManualScriptDocument, parseQaResult, parseRegeneratedParagraphs, translateManualParseError, validateScriptOutlineChapterCount } from './ai/parse-output';
import { applyRegeneratedChapter, buildRegenerationPromptForChapter, finalizeScript, getChapterHistory, patchChapter, regenerateChapter, restoreChapters, saveGeneratedScript, snapshotOf } from './service';

type EnqueueScriptJob = (input: { type: string; projectId: string; payload: unknown }) => Promise<{ id: string }>;
type GetActiveScriptJob = (projectId: string, type: string) => Promise<{ id: string } | null>;

const PatchChapterSchema = z.object({
  status: z.enum(['pending', 'approved', 'needs-fix']).optional(),
  paragraphs: z.array(z.string()).optional(),
  title: z.string().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one chapter field is required.');

const RegenerateChapterSchema = z.object({
  instruction: z.string(),
  level: z.enum(['light', 'medium', 'rewrite']),
});
const ManualRegeneratePromptSchema = RegenerateChapterSchema.strict();

const RestoreSchema = z.object({ index: z.number().int().nonnegative() });
const ProviderSchema = z.object({ provider: z.enum(['deepseek', 'claude']), aiModel: z.string().optional() }).strict();
const VisualStyleSchema = z.object({ visualStylePresetId: z.enum(VISUAL_STYLE_IDS) }).strict();
const ManualImportSchema = z.object({ raw: z.string() }).strict();

function writeEvent(res: { write: (chunk: string) => boolean }, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function assertVisualPromptSourceReady(project: Awaited<ReturnType<typeof getProject>>): void {
  const hasValidChapterCounts = project.chapters.every(
    (chapter) => Number.isInteger(chapter.scenesCount) && (chapter.scenesCount ?? 0) > 0,
  );
  const sceneCount = project.chapters.reduce((sum, chapter) => sum + (chapter.scenesCount ?? 0), 0);
  if (project.scenes.length === 0 || !hasValidChapterCounts || sceneCount !== project.scenes.length) {
    throw new AppError('Finalized scenes are required before generating visual prompts.', 422, 'SCENES_NOT_READY');
  }
}

export function createScriptRouter(options: { enqueueJob: EnqueueScriptJob; getActiveJob?: GetActiveScriptJob }): Router {
  const router = Router();

  router.post('/:id/generate-script', async (req, res) => {
    const project = await getProject(req.params.id);
    const activeJob = await options.getActiveJob?.(project.id, 'generate-script');
    if (activeJob) {
      res.status(200).json({ jobId: activeJob.id });
      return;
    }
    const job = await options.enqueueJob({ type: 'generate-script', projectId: project.id, payload: { projectId: project.id } });
    res.status(201).json({ jobId: job.id });
  });

  router.post('/:id/qa', async (req, res) => {
    const project = await getProject(req.params.id);
    const job = await options.enqueueJob({ type: 'final-qa', projectId: project.id, payload: { projectId: project.id } });
    res.status(201).json({ jobId: job.id });
  });

  router.get('/:id/qa/manual-prompt', async (req, res) => {
    const project = await getProject(req.params.id);
    const prompt = buildQaPrompt(project);
    res.json({
      prompt: `SYSTEM\n${prompt.system}\n\nUSER\n${prompt.user}`,
      promptVersion: prompt.promptVersion,
    });
  });

  router.post('/:id/qa/manual-import', async (req, res) => {
    const body = ManualImportSchema.parse(req.body);
    let result: ReturnType<typeof parseQaResult>;
    try {
      result = parseQaResult(body.raw);
    } catch (error) {
      translateManualParseError(error, 'qa');
    }
    const project = await getProject(req.params.id);
    const chapterCount = project.chapterCount ?? project.chapters.length;
    const invalidChapter = result.issues.find((issue) => issue.chapter > chapterCount);
    if (invalidChapter) {
      throw new AppError(`Kết quả QA tham chiếu chương ${invalidChapter.chapter}, nhưng dự án chỉ có ${chapterCount} chương.`, 422, 'QA_CHAPTER_OUT_OF_RANGE');
    }
    res.json({ ...result, reviewedBy: { provider: 'manual', model: 'Dán thủ công' } });
  });

  router.patch('/:id/ai-provider', async (req, res) => {
    const body = ProviderSchema.parse(req.body);
    res.json(await setProjectAiProvider(req.params.id, body.provider, body.aiModel));
  });

  router.patch('/:id/visual-style', async (req, res) => {
    const body = VisualStyleSchema.parse(req.body);
    res.json(await setProjectVisualStylePreset(req.params.id, body.visualStylePresetId));
  });

  router.get('/:id/generate-script/manual-prompt', async (req, res) => {
    const project = await getProject(req.params.id);
    const prompt = buildManualScriptPrompt(project);
    res.json({
      prompt: `SYSTEM\n${prompt.system}\n\nUSER\n${prompt.user}`,
      promptVersion: prompt.promptVersion,
    });
  });

  router.post('/:id/generate-script/manual-import', async (req, res) => {
    const body = ManualImportSchema.parse(req.body);
    const project = await getProject(req.params.id);
    let document: ReturnType<typeof parseManualScriptDocument>;
    try {
      document = parseManualScriptDocument(body.raw, project.scriptPresetId);
      validateScriptOutlineChapterCount(document, project.chapterCount);
    } catch (error) {
      translateManualParseError(error, 'script');
    }
    const saved = await saveGeneratedScript(project.id, document.chapters, document.openLoops, 'motif' in document ? document.motif : null, document.coreQuestion, document.openingHook);
    res.json(saved);
  });

  router.post('/:id/scenes/generate-visual-prompts', async (req, res) => {
    const project = await getProject(req.params.id);
    assertVisualPromptSourceReady(project);
    const job = await options.enqueueJob({
      type: 'generate-visual-prompts',
      projectId: project.id,
      payload: { projectId: project.id },
    });
    res.status(201).json({ jobId: job.id });
  });

  router.post('/:id/scenes/split', async (req, res) => {
    const project = await getProject(req.params.id);
    assertVisualPromptSourceReady(project);
    const job = await options.enqueueJob({
      type: 'split-scenes',
      projectId: project.id,
      payload: { projectId: project.id },
    });
    res.status(201).json({ jobId: job.id });
  });

  router.patch('/:id/chapters/:chapterId', async (req, res) => {
    const patch = PatchChapterSchema.parse(req.body);
    res.json({ chapters: await patchChapter(req.params.id, req.params.chapterId, patch) });
  });

  router.post('/:id/chapters/:chapterId/regenerate', async (req, res) => {
    const body = RegenerateChapterSchema.parse(req.body);
    const controller = new AbortController();
    let closed = false;
    req.on('close', () => {
      // IncomingMessage can close normally after the request body is consumed;
      // response close is the reliable disconnect signal once headers are sent.
      if (!res.headersSent) { closed = true; controller.abort(); }
    });
    res.on('close', () => {
      if (!res.writableEnded) { closed = true; controller.abort(); }
    });
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    try {
      const chapter = await regenerateChapter(req.params.id, req.params.chapterId, body, (chunk) => {
        if (!closed) writeEvent(res, 'chunk', chunk);
      }, controller.signal);
      if (!closed) {
        writeEvent(res, 'done', chapter);
        res.end();
      }
    } catch (error) {
      if (!closed) {
        writeEvent(res, 'error', error instanceof Error ? error.message : String(error));
        res.end();
      }
    }
  });

  router.post('/:id/chapters/:chapterId/regenerate/manual-prompt', async (req, res) => {
    const body = ManualRegeneratePromptSchema.parse(req.body);
    const project = await getProject(req.params.id);
    const { prompt } = buildRegenerationPromptForChapter(project, req.params.chapterId, body);
    res.json({
      prompt: `SYSTEM\n${prompt.system}\n\nUSER\n${prompt.user}`,
      promptVersion: prompt.promptVersion,
    });
  });

  router.post('/:id/chapters/:chapterId/regenerate/manual-import', async (req, res) => {
    const body = ManualImportSchema.parse(req.body);
    let regenerated: ReturnType<typeof parseRegeneratedParagraphs>;
    try {
      regenerated = parseRegeneratedParagraphs(body.raw);
    } catch (error) {
      translateManualParseError(error, 'chapter');
    }
    const project = await getProject(req.params.id);
    const snapshot = snapshotOf(project.chapters);
    const { chapter, nextChapter } = buildRegenerationPromptForChapter(project, req.params.chapterId, { instruction: '', level: 'medium' });
    res.json(await applyRegeneratedChapter(project.id, chapter, nextChapter, regenerated, snapshot));
  });

  router.get('/:id/chapters/history', async (req, res) => {
    res.json(await getChapterHistory(req.params.id));
  });

  router.post('/:id/chapters/restore', async (req, res) => {
    const body = RestoreSchema.parse(req.body);
    res.json({ chapters: await restoreChapters(req.params.id, body.index) });
  });

  router.post('/:id/finalize-script', async (req, res) => {
    await finalizeScript(req.params.id);
    res.json(await getProject(req.params.id));
  });

  return router;
}
