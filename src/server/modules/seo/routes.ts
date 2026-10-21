import { Router } from 'express';
import { z } from 'zod';
import { SEO_SECTIONS, SeoPatchSchema, type SeoSection } from '../../../contracts/seo';
import { AppError } from '../../shared/errors';
import { uploadThumbnail } from '../../shared/upload';
import { applyGeneratedSeoSections, getProject, patchProjectSeo } from '../project';
import { buildSeoPrompt } from './ai/build-prompt';
import { parseSeoOutput, SeoAiOutputError } from './ai/parse-output';
import { getSeoChannel, mergeGeneratedChannelDefaults } from './service';
import { configureThumbnailService, removeProjectThumbnail, replaceProjectThumbnail, THUMBNAIL_MIME_TYPES } from './thumbnail-service';

type EnqueueSeoJob = (input: { type: string; projectId: string; payload: unknown }) => Promise<{ id: string }>;
type GetActiveSeoJob = (projectId: string, type: string) => Promise<{ id: string } | null>;

const SeoSectionsSchema = z.array(z.enum(SEO_SECTIONS)).min(1).transform((sections) => [...new Set(sections)]);
const GenerateSchema = z.object({ sections: SeoSectionsSchema.optional() }).strict();
const ManualImportSchema = z.object({ raw: z.string(), sections: SeoSectionsSchema }).strict();

function allSections(): SeoSection[] {
  return [...SEO_SECTIONS];
}

function parseSectionsQuery(value: unknown): SeoSection[] {
  if (value === undefined) return allSections();
  if (typeof value !== 'string') throw new AppError('sections phải là chuỗi phân tách bằng dấu phẩy.', 400, 'validation_error');
  return SeoSectionsSchema.parse(value.split(','));
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

export function createSeoRouter(options: { enqueueJob: EnqueueSeoJob; getActiveJob?: GetActiveSeoJob }): Router {
  const router = Router();

  router.post('/:id/seo/generate', async (req, res) => {
    const body = GenerateSchema.parse(req.body ?? {});
    const project = await getProject(req.params.id);
    if (project.chapters.length === 0) throw new AppError('Cần có ít nhất một chương trước khi tạo gói SEO.', 422, 'SCRIPT_NOT_READY');
    const sections = body.sections ?? allSections();
    const active = await options.getActiveJob?.(project.id, 'generate-seo');
    if (active) { res.status(200).json({ jobId: active.id }); return; }
    const job = await options.enqueueJob({ type: 'generate-seo', projectId: project.id, payload: { projectId: project.id, sections } });
    res.status(201).json({ jobId: job.id });
  });

  router.get('/:id/seo/manual-prompt', async (req, res) => {
    const sections = parseSectionsQuery(req.query.sections);
    const project = await getProject(req.params.id);
    const channel = await getSeoChannel(project);
    const prompt = buildSeoPrompt(project, sections, channel);
    res.json({ prompt: `SYSTEM\n${prompt.system}\n\nUSER\n${prompt.user}`, promptVersion: prompt.promptVersion });
  });

  router.post('/:id/seo/manual-import', async (req, res) => {
    const body = ManualImportSchema.parse(req.body);
    const project = await getProject(req.params.id);
    let parsed: ReturnType<typeof parseSeoOutput>;
    try {
      parsed = parseSeoOutput(body.raw, body.sections);
    } catch (error) {
      translateManualParseError(error);
    }
    const channel = await getSeoChannel(project);
    const saved = await applyGeneratedSeoSections(project.id, body.sections, {
      ...mergeGeneratedChannelDefaults(body.sections, parsed, channel),
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
