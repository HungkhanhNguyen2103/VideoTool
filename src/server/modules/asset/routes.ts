import { Router } from 'express';
import { z } from 'zod';
import { VideoDistributionApplyRequestSchema, VideoDistributionRequestSchema } from '../../../contracts/asset';
import { getProject, patchProjectScene, setProjectScenesAssetType } from '../project';
import { AppError, FieldAppError } from '../../shared/errors';
import { uploadAssetZip } from '../../shared/upload';
import { applyVideoDistribution, exportScenesJson, importAssetsFromZip, previewVideoDistribution, requestDepthMapsForImageScenes } from './service';

const PatchSceneSchema = z.object({
  narration: z.string().trim().min(1).max(2000).optional(),
  visualPrompt: z.string().optional(),
  assetType: z.enum(['image', 'video']).optional(),
  sfxPrompt: z.string().optional(),
  motionPrompt: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'), { message: 'At least one scene field is required.' });
const AssetTypeSchema = z.object({ assetType: z.enum(['image', 'video']) });

function validationFields(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export const assetRouter = Router();

assetRouter.get('/:id/scenes/export-json', async (req, res) => {
  const project = await getProject(String(req.params.id));
  res.setHeader('Content-Disposition', 'attachment; filename="scenes-export.json"');
  res.json(exportScenesJson(project));
});

assetRouter.post('/:id/scenes/import-assets', uploadAssetZip, async (req, res) => {
  const projectId = String(req.params.id);
  await getProject(projectId);
  const file = req.file;
  if (!file) throw new AppError('File is required.', 400, 'FILE_REQUIRED');
  if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed') {
    throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  }
  res.json(await importAssetsFromZip(projectId, file.buffer));
});

assetRouter.patch('/:id/scenes/:sceneId', async (req, res) => {
  const parsed = PatchSceneSchema.safeParse(req.body);
  if (!parsed.success) {
    const hasNarrationError = parsed.error.issues.some((issue) => issue.path[0] === 'narration');
    if (hasNarrationError) throw new FieldAppError('Dữ liệu không hợp lệ.', 422, 'validation_error', validationFields(parsed.error));
    throw parsed.error;
  }
  const { expectedVersion, ...patch } = parsed.data;
  res.json(await patchProjectScene(String(req.params.id), String(req.params.sceneId), patch, expectedVersion));
});

assetRouter.post('/:id/scenes/set-asset-type', async (req, res) => {
  const body = AssetTypeSchema.parse(req.body);
  const projectId = String(req.params.id);
  const project = await setProjectScenesAssetType(projectId, body.assetType);
  if (body.assetType === 'image') await requestDepthMapsForImageScenes(projectId);
  res.json(project);
});

assetRouter.post('/:id/scenes/video-distribution/preview', async (req, res) => {
  const parsed = VideoDistributionRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new FieldAppError('Dữ liệu không hợp lệ.', 422, 'validation_error', validationFields(parsed.error));
  res.json(await previewVideoDistribution(String(req.params.id), parsed.data.targetPercent));
});

assetRouter.post('/:id/scenes/video-distribution/apply', async (req, res) => {
  const parsed = VideoDistributionApplyRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new FieldAppError('Dữ liệu không hợp lệ.', 422, 'validation_error', validationFields(parsed.error));
  res.json(await applyVideoDistribution(String(req.params.id), parsed.data.targetPercent, parsed.data.expectedVersion));
});
