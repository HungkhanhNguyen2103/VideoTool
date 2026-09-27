import { Router } from 'express';
import { z } from 'zod';
import { getProject, patchProjectScene, setProjectScenesAssetType } from '../project';
import { AppError } from '../../shared/errors';
import { uploadAssetZip } from '../../shared/upload';
import { exportScenesJson, importAssetsFromZip, requestDepthMapsForImageScenes } from './service';

const PatchSceneSchema = z.object({
  visualPrompt: z.string().optional(),
  assetType: z.enum(['image', 'video']).optional(),
  sfxPrompt: z.string().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one scene field is required.' });
const AssetTypeSchema = z.object({ assetType: z.enum(['image', 'video']) });

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
  const body = PatchSceneSchema.parse(req.body);
  res.json(await patchProjectScene(String(req.params.id), String(req.params.sceneId), body));
});

assetRouter.post('/:id/scenes/set-asset-type', async (req, res) => {
  const body = AssetTypeSchema.parse(req.body);
  const projectId = String(req.params.id);
  const project = await setProjectScenesAssetType(projectId, body.assetType);
  if (body.assetType === 'image') await requestDepthMapsForImageScenes(projectId);
  res.json(project);
});
