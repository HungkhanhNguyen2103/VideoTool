import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { VISUAL_STYLE_IDS, type VisualStyleId } from '../../../contracts/project';
import { VisualStyleSampleSchema, VisualStyleSamplesSchema, type VisualStyleSample, type VisualStyleSamples } from '../../../contracts/visual-style-sample';
import { getCollection } from '../../db/client';
import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { uploadReference } from '../../shared/upload';
import { extensionFor } from './service';

type VisualStyleSampleDoc = {
  _id: VisualStyleId;
  storedPath: string;
  mimeType: string;
  originalName: string;
  createdAt: Date;
};

const StyleIdSchema = z.enum(VISUAL_STYLE_IDS);
const STYLE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const collection = () => getCollection<VisualStyleSampleDoc>('visual_style_samples');

function entry(storedPath: string, filename: string, source: 'shared' | 'project', updatedAt: Date): VisualStyleSample {
  return VisualStyleSampleSchema.parse({ url: `/files/${encodeURIComponent(storedPath)}`, filename, source, updatedAt: updatedAt.toISOString() });
}

export function createVisualStyleSamplesService(filesDir: string) {
  async function listSamples(): Promise<VisualStyleSamples> {
    const result: VisualStyleSamples = {};
    for (const sample of await collection().find().toArray()) {
      result[sample._id] = entry(sample.storedPath, sample.originalName, 'shared', sample.createdAt);
    }
    return VisualStyleSamplesSchema.parse(result);
  }

  async function storeSample(styleId: VisualStyleId, file: Express.Multer.File): Promise<VisualStyleSample> {
    await mkdir(filesDir, { recursive: true });
    const storedPath = `${newId()}.${extensionFor('', file.mimetype)}`;
    await writeFile(path.join(filesDir, storedPath), file.buffer);
    const next: VisualStyleSampleDoc = {
      _id: styleId,
      storedPath,
      mimeType: file.mimetype,
      originalName: file.originalname,
      createdAt: new Date(),
    };
    let previous: VisualStyleSampleDoc | null;
    try {
      previous = await collection().findOneAndReplace({ _id: styleId }, next, { upsert: true, returnDocument: 'before' });
    } catch (error) {
      await unlink(path.join(filesDir, storedPath)).catch(() => undefined);
      throw error;
    }
    if (previous) await unlink(path.join(filesDir, previous.storedPath)).catch(() => undefined);
    return entry(next.storedPath, next.originalName, 'shared', next.createdAt);
  }

  return { listSamples, storeSample };
}

let configuredService = createVisualStyleSamplesService('./data/files');
export function configureVisualStyleSamples(filesDir: string): void { configuredService = createVisualStyleSamplesService(filesDir); }

export const visualStyleSamplesRouter = Router();
visualStyleSamplesRouter.get('/', async (_req, res) => { res.json(await configuredService.listSamples()); });
visualStyleSamplesRouter.put('/:styleId', uploadReference, async (req, res) => {
  const styleId = StyleIdSchema.parse(req.params.styleId);
  const file = req.file;
  if (!file) throw new AppError('File is required.', 400, 'FILE_REQUIRED');
  if (!(STYLE_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  res.json(await configuredService.storeSample(styleId, file));
});
