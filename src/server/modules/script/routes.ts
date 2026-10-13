import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { VISUAL_STYLE_IDS } from '../../../contracts/project';
import { CliRegenerateRequestSchema, GenerateScriptRequestSchema, ManualRegeneratePromptSchema, RegenerateChapterRequestSchema } from '../../../contracts/script';
import { getProject, setProjectAiProvider, setProjectVisualStylePreset } from '../project';
import { AppError } from '../../shared/errors';
import { loadConfig } from '../../config';
import { getClaudeCliStatus as readClaudeCliStatus, type ClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import { buildManualScriptPrompt, buildQaPrompt } from './ai/build-prompt';
import { parseManualScriptDocument, parseQaResult, translateManualParseError, validateScriptOutlineChapterCount } from './ai/parse-output';
import { buildRegenerationPromptForChapter, finalizeScript, formatRegenerationPrompt, getChapterHistory, importRegeneratedChapter, patchChapter, regenerateChapter, restoreChapters, saveGeneratedScript } from './service';
import { getManualOutlineWarnings, recommendScriptChapterCount } from './ai/outline-validation';
import { summarizeManualScriptQuality } from './quality';

type EnqueueScriptJob = (input: { type: string; projectId: string; payload: unknown; maxAttempts?: number }) => Promise<{ id: string }>;
type GetActiveScriptJob = (projectId: string, type: string) => Promise<{ id: string; payload: unknown } | null>;
type ScriptCliStatusReader = () => Promise<ClaudeCliStatus>;

const PatchChapterSchema = z.object({
  status: z.enum(['pending', 'approved', 'needs-fix']).optional(),
  paragraphs: z.array(z.string()).optional(),
  title: z.string().optional(),
  historyBatchId: z.string().uuid().optional(),
}).refine((value) => value.status !== undefined || value.paragraphs !== undefined || value.title !== undefined, 'At least one chapter field is required.');

const RestoreSchema = z.object({ index: z.number().int().nonnegative(), expectedVersion: z.number().int().nonnegative().optional() });
const ProviderSchema = z.object({ provider: z.enum(['deepseek', 'claude']), aiModel: z.string().optional() }).strict();
const VisualStyleSchema = z.object({ visualStylePresetId: z.enum(VISUAL_STYLE_IDS) }).strict();
const ManualImportSchema = z.object({ raw: z.string() }).strict();
async function configuredClaudeCliStatus(): Promise<ClaudeCliStatus> {
  const config = loadConfig();
  return readClaudeCliStatus({ executablePath: config.CLAUDE_CLI_PATH, env: process.env });
}

export function createScriptCliStatusRouter(readStatus: ScriptCliStatusReader = configuredClaudeCliStatus): Router {
  const router = Router();
  router.get('/cli-status', async (_req, res) => { res.json(await readStatus()); });
  return router;
}

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

export function createScriptRouter(options: {
  enqueueJob: EnqueueScriptJob;
  getActiveJob?: GetActiveScriptJob;
  getClaudeCliStatus?: ScriptCliStatusReader;
}): Router {
  const router = Router();

  router.post('/:id/generate-script', async (req, res) => {
    const project = await getProject(req.params.id);
    const body = GenerateScriptRequestSchema.parse(req.body ?? {});
    const backend = body.backend ?? 'api';
    if (backend === 'cli') {
      const status = await (options.getClaudeCliStatus ?? configuredClaudeCliStatus)();
      if (!status.available) {
        throw new AppError('Claude Code CLI chưa khả dụng trên máy chủ này. Hãy kiểm tra cài đặt và đăng nhập rồi thử lại.', 503, 'CLAUDE_CLI_UNAVAILABLE');
      }
    }
    const activeJob = await options.getActiveJob?.(project.id, 'generate-script');
    if (activeJob) {
      const activePayload = z.object({
        resume: z.boolean().optional(),
        backend: z.enum(['api', 'cli']).optional(),
        cliModel: z.string().nullable().optional(),
      }).passthrough().safeParse(activeJob.payload);
      const activeResume = activePayload.success ? activePayload.data.resume ?? false : false;
      const activeBackend = activePayload.success ? activePayload.data.backend ?? 'api' : 'api';
      const activeCliModel = activePayload.success ? activePayload.data.cliModel ?? null : null;
      if (activeResume !== (body.resume ?? false)
        || activeBackend !== backend
        || (backend === 'cli' && activeCliModel !== (body.cliModel ?? null))) {
        const activeLabel = activeBackend === 'cli'
          ? `Claude CLI${activeCliModel ? ` (${activeCliModel})` : ''}`
          : 'API';
        throw new AppError(`Đang có job tạo kịch bản bằng ${activeLabel} với chế độ ${activeResume ? 'tiếp tục' : 'viết mới'}. Hãy chờ job hoàn tất hoặc hủy trước khi chọn backend, model hay chế độ khác.`, 409, 'SCRIPT_GENERATION_BACKEND_MISMATCH');
      }
      res.status(200).json({ jobId: activeJob.id });
      return;
    }
    const job = await options.enqueueJob({
      type: 'generate-script',
      projectId: project.id,
      ...(backend === 'cli' ? { maxAttempts: 1 } : {}),
      payload: {
        projectId: project.id,
        ...(body.resume ? { resume: true } : {}),
        ...(body.backend ? { backend: body.backend } : {}),
        ...(body.cliModel !== undefined ? { cliModel: body.cliModel } : {}),
      },
    });
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
      validateScriptOutlineChapterCount(document, project.chapterCount ?? recommendScriptChapterCount(project.targetDurationSec));
    } catch (error) {
      translateManualParseError(error, 'script');
    }
    const saved = await saveGeneratedScript(project.id, document.chapters, document.openLoops, 'motif' in document ? document.motif : null, document.coreQuestion, document.openingHook);
    const quality = summarizeManualScriptQuality({ targetDurationSec: project.targetDurationSec, scriptPresetId: project.scriptPresetId, chapters: saved.chapters });
    const plannedActWarnings = getManualOutlineWarnings(document, project).filter((warning) => warning.startsWith('Act '));
    res.json({ project: saved, quality: { ...quality, warnings: [...new Set([...quality.warnings, ...plannedActWarnings])] } });
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
    const { historyBatchId, ...chapterPatch } = patch;
    res.json({ chapters: await patchChapter(req.params.id, req.params.chapterId, chapterPatch, historyBatchId) });
  });

  router.post('/:id/chapters/:chapterId/regenerate', async (req, res) => {
    const body = RegenerateChapterRequestSchema.parse(req.body);
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
        writeEvent(res, 'error-details', error instanceof AppError ? { code: error.code, status: error.status } : { code: null, status: null });
        res.end();
      }
    }
  });

  router.post('/:id/chapters/:chapterId/regenerate/manual-prompt', async (req, res) => {
    const body = ManualRegeneratePromptSchema.parse(req.body);
    const project = await getProject(req.params.id);
    const { prompt } = buildRegenerationPromptForChapter(project, req.params.chapterId, body);
    res.json({
      prompt: formatRegenerationPrompt(prompt),
      promptVersion: prompt.promptVersion,
    });
  });

  router.post('/:id/chapters/regenerate/cli', async (req, res) => {
    const body = CliRegenerateRequestSchema.parse(req.body);
    const project = await getProject(req.params.id);
    const status = await (options.getClaudeCliStatus ?? configuredClaudeCliStatus)();
    if (!status.available) {
      throw new AppError(status.reason ?? 'Claude Code CLI hiện chưa sẵn sàng.', 503, 'CLAUDE_CLI_UNAVAILABLE');
    }
    const selected = new Set(body.chapterIds);
    const availableIds = new Set(project.chapters.map((chapter) => chapter.id));
    const unknownId = body.chapterIds.find((chapterId) => !availableIds.has(chapterId));
    if (unknownId) throw new AppError('Có chương được chọn không còn trong dự án.', 422, 'CHAPTER_NOT_FOUND');
    const orderedChapterIds = project.chapters
      .filter((chapter) => selected.has(chapter.id))
      .sort((left, right) => left.no - right.no)
      .map((chapter) => chapter.id);
    if (project.chapters.some((chapter) => selected.has(chapter.id) && chapter.status === 'generating')) {
      throw new AppError('Một chương được chọn đang được tái tạo.', 409, 'CHAPTER_BUSY');
    }
    const job = await options.enqueueJob({
      type: 'regenerate-chapters-claude-cli',
      projectId: project.id,
      maxAttempts: 1,
      payload: {
        projectId: project.id,
        chapterIds: orderedChapterIds,
        instruction: body.instruction,
        level: body.level,
        ...(body.model ? { model: body.model } : {}),
        historyBatchId: randomUUID(),
      },
    });
    res.status(201).json({ jobId: job.id });
  });

  router.post('/:id/chapters/:chapterId/regenerate/manual-import', async (req, res) => {
    const body = ManualImportSchema.parse(req.body);
    let imported: Awaited<ReturnType<typeof importRegeneratedChapter>>;
    try {
      imported = await importRegeneratedChapter(req.params.id, req.params.chapterId, body.raw);
    } catch (error) {
      translateManualParseError(error, 'chapter');
    }
    res.json(imported);
  });

  router.get('/:id/chapters/history', async (req, res) => {
    res.json(await getChapterHistory(req.params.id));
  });

  router.post('/:id/chapters/restore', async (req, res) => {
    const body = RestoreSchema.parse(req.body);
    res.json({ chapters: await restoreChapters(req.params.id, body.index, body.expectedVersion) });
  });

  router.post('/:id/finalize-script', async (req, res) => {
    await finalizeScript(req.params.id);
    res.json(await getProject(req.params.id));
  });

  return router;
}
