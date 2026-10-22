import { Router } from 'express';
import { z } from 'zod';
import { SEO_SECTIONS, SeoPatchSchema, type SeoSection } from '../../../contracts/seo';
import { isAiModelForProvider } from '../../../contracts/ai-models';
import { pickShortsWindows } from '../../../contracts/seo-shorts';
import { loadConfig } from '../../config';
import type { Config } from '../../config';
import { assertClaudeCliAvailable, assertClaudeCliStatusAvailable } from '../../shared/claude-cli/cli-chat';
import type { ClaudeCliStatus } from '../../shared/claude-cli/cli-runner';
import { AppError } from '../../shared/errors';
import { uploadThumbnail } from '../../shared/upload';
import { applyGeneratedSeoSections, getProject, listChosenSeoTitlesByChannel, patchProjectSeo } from '../project';
import { buildSeoPrompt, buildShortsPrompt } from './ai/build-prompt';
import { parseSeoOutput, parseShortsOutput, SeoAiOutputError } from './ai/parse-output';
import { getSeoChannel, mergeGeneratedChannelDefaults, mergeGeneratedShortsChannelDefaults } from './service';
import { configureThumbnailService, removeProjectThumbnail, replaceProjectThumbnail, THUMBNAIL_MIME_TYPES } from './thumbnail-service';

type EnqueueSeoJob = (input: { type: string; projectId: string; payload: unknown; maxAttempts?: number }) => Promise<{ id: string }>;
type GetActiveSeoJob = (projectId: string, type: string) => Promise<{ id: string; payload?: unknown } | null>;
type SeoCliStatusReader = () => Promise<ClaudeCliStatus>;

const SeoSectionsSchema = z.array(z.enum(SEO_SECTIONS)).min(1).transform((sections) => [...new Set(sections)]);
const GenerateSchema = z.object({
  sections: SeoSectionsSchema.optional(),
  backend: z.enum(['api', 'cli']).optional(),
  cliModel: z.string().trim().optional(),
}).strict();
const ManualImportSchema = z.object({ raw: z.string(), sections: SeoSectionsSchema }).strict();

function allSections(): SeoSection[] {
  return [...SEO_SECTIONS];
}

function manualDefaultSections(): SeoSection[] {
  return SEO_SECTIONS.filter((section) => section !== 'shorts');
}

function parseSectionsQuery(value: unknown): SeoSection[] {
  if (value === undefined) return manualDefaultSections();
  if (typeof value !== 'string') throw new AppError('sections phải là chuỗi phân tách bằng dấu phẩy.', 400, 'validation_error');
  return SeoSectionsSchema.parse(value.split(','));
}

function assertManualSections(sections: readonly SeoSection[]): void {
  if (sections.includes('shorts') && sections.length !== 1) {
    throw new AppError('Gói Shorts cần tạo riêng ở chế độ thủ công.', 422, 'SHORTS_MANUAL_STANDALONE');
  }
}

function translateManualParseError(error: unknown): never {
  if (!(error instanceof SeoAiOutputError)) throw error;
  const detail = error.message.replace(/^SEO AI output invalid: /, '');
  if (detail === 'root: invalid JSON') {
    throw new AppError('JSON của gói SEO không hợp lệ. Hãy dán nguyên văn JSON do AI trả về, không kèm chữ giải thích bên ngoài; kiểm tra dấu ngoặc và dấu phẩy.', 422, 'SEO_PARSE_ERROR');
  }
  throw new AppError(`JSON của gói SEO thiếu hoặc sai trường: ${detail}${detail.endsWith('.') ? '' : '.'}`, 422, 'SEO_PARSE_ERROR');
}

export function configureSeoModule(filesDir: string): void {
  configureThumbnailService(filesDir);
}

export function createSeoRouter(options: {
  enqueueJob: EnqueueSeoJob;
  getActiveJob?: GetActiveSeoJob;
  getClaudeCliStatus?: SeoCliStatusReader;
  config?: Pick<Config, 'CLAUDE_CLI_PATH'>;
}): Router {
  const router = Router();

  router.post('/:id/seo/generate', async (req, res) => {
    const body = GenerateSchema.parse(req.body ?? {});
    const project = await getProject(req.params.id);
    if (project.chapters.length === 0) throw new AppError('Cần có ít nhất một chương trước khi tạo gói SEO.', 422, 'SCRIPT_NOT_READY');
    const sections = body.sections ?? allSections();
    const backend = body.backend ?? 'api';
    if (body.cliModel !== undefined && !isAiModelForProvider('claude', body.cliModel)) {
      throw new AppError(`Model ${body.cliModel} không còn khả dụng cho Claude CLI; hãy chọn model khác.`, 422, 'AI_MODEL_UNAVAILABLE');
    }
    if (backend === 'cli') {
      if (options.getClaudeCliStatus) assertClaudeCliStatusAvailable(await options.getClaudeCliStatus());
      else {
        const config = options.config ?? loadConfig();
        await assertClaudeCliAvailable({ CLAUDE_CLI_PATH: config.CLAUDE_CLI_PATH });
      }
    }
    const active = await options.getActiveJob?.(project.id, 'generate-seo');
    if (active) {
      const activePayload = z.object({ backend: z.enum(['api', 'cli']).optional(), cliModel: z.string().nullable().optional() }).passthrough().safeParse(active.payload);
      const activeBackend = activePayload.success ? activePayload.data.backend ?? 'api' : 'api';
      const activeCliModel = activePayload.success ? activePayload.data.cliModel ?? null : null;
      if (activeBackend !== backend || (backend === 'cli' && activeCliModel !== (body.cliModel ?? null))) {
        throw new AppError('Đang có job tạo gói SEO bằng backend khác. Hãy chờ job hoàn tất hoặc hủy trước khi đổi backend hoặc model.', 409, 'SEO_GENERATION_BACKEND_MISMATCH');
      }
      res.status(200).json({ jobId: active.id });
      return;
    }
    const job = await options.enqueueJob({
      type: 'generate-seo',
      projectId: project.id,
      ...(backend === 'cli' ? { maxAttempts: 1 } : {}),
      payload: {
        projectId: project.id,
        sections,
        ...(body.backend ? { backend: body.backend } : {}),
        ...(body.cliModel !== undefined ? { cliModel: body.cliModel } : {}),
      },
    });
    res.status(201).json({ jobId: job.id });
  });

  router.get('/:id/seo/manual-prompt', async (req, res) => {
    const sections = parseSectionsQuery(req.query.sections);
    assertManualSections(sections);
    const project = await getProject(req.params.id);
    const channel = await getSeoChannel(project);
    const prompt = sections.includes('shorts')
      ? buildShortsPrompt(project, pickShortsWindows(project).windows, channel)
      : buildSeoPrompt(project, sections, channel);
    res.json({ prompt: `SYSTEM\n${prompt.system}\n\nUSER\n${prompt.user}`, promptVersion: prompt.promptVersion });
  });

  router.get('/:id/seo/channel-titles', async (req, res) => {
    const project = await getProject(req.params.id);
    const titles = project.channelId
      ? await listChosenSeoTitlesByChannel(project.channelId, project.id)
      : [];
    res.json({ titles });
  });

  router.post('/:id/seo/manual-import', async (req, res) => {
    const body = ManualImportSchema.parse(req.body);
    assertManualSections(body.sections);
    const project = await getProject(req.params.id);
    const channel = await getSeoChannel(project);
    let parsed: ReturnType<typeof parseSeoOutput> | ReturnType<typeof parseShortsOutput>;
    try {
      parsed = body.sections.includes('shorts')
        ? parseShortsOutput(body.raw, pickShortsWindows(project).windows)
        : parseSeoOutput(body.raw, body.sections);
    } catch (error) {
      translateManualParseError(error);
    }
    const channelMerged = body.sections.includes('shorts')
      ? mergeGeneratedShortsChannelDefaults(parsed as ReturnType<typeof parseShortsOutput>, channel)
      : mergeGeneratedChannelDefaults(body.sections, parsed as ReturnType<typeof parseSeoOutput>, channel);
    const saved = await applyGeneratedSeoSections(project.id, body.sections, {
      ...channelMerged,
      generatedBy: { provider: 'manual', model: 'Dán thủ công', promptVersion: 'manual', generatedAt: new Date().toISOString() },
    });
    res.json(saved);
  });

  router.patch('/:id/seo', async (req, res) => {
    res.json(await patchProjectSeo(req.params.id, SeoPatchSchema.parse(req.body)));
  });

  router.put('/:id/seo/thumbnail', uploadThumbnail, async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError('Vui lòng chọn tệp thumbnail.', 400, 'FILE_REQUIRED');
    if (!THUMBNAIL_MIME_TYPES.has(file.mimetype)) throw new AppError('Thumbnail phải là PNG hoặc JPEG.', 400, 'INVALID_FILE_TYPE');
    res.json(await replaceProjectThumbnail(String(req.params.id), file));
  });

  router.delete('/:id/seo/thumbnail', async (req, res) => {
    res.json(await removeProjectThumbnail(String(req.params.id)));
  });

  return router;
}
