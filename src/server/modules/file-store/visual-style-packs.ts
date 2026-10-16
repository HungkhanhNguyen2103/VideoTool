import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { VISUAL_STYLE_IDS, type VisualStyleId } from '../../../contracts/project';
import { isVisualStylePackSlot, VisualStylePackSlotIdSchema, VisualStylePacksSchema, type VisualStylePacks } from '../../../contracts/visual-style-pack';
import { VisualStyleSampleSchema, type VisualStyleSample } from '../../../contracts/visual-style-sample';
import { getCollection } from '../../db/client';
import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { uploadReference } from '../../shared/upload';
import { extensionFor } from './service';
import { createVisualStyleSamplesService } from './visual-style-samples';

type VisualStylePackImageDoc = {
  _id: string;
  styleId: VisualStyleId;
  slotId: string;
  storedPath: string;
  mimeType: string;
  originalName: string;
  createdAt: Date;
};

const StyleIdSchema = z.enum(VISUAL_STYLE_IDS);
const STYLE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const collection = () => getCollection<VisualStylePackImageDoc>('visual_style_pack_images');

function entry(doc: VisualStylePackImageDoc): VisualStyleSample {
  return VisualStyleSampleSchema.parse({
    url: `/files/${encodeURIComponent(doc.storedPath)}`,
    filename: doc.originalName,
    source: 'shared',
    updatedAt: doc.createdAt.toISOString(),
  });
}

function validateSlot(styleIdInput: unknown, slotIdInput: unknown): { styleId: VisualStyleId; slotId: string } {
  const styleResult = StyleIdSchema.safeParse(styleIdInput);
  if (!styleResult.success) throw new AppError('Phong cách hình ảnh không hợp lệ.', 400, 'INVALID_VISUAL_STYLE');
  const slotId = VisualStylePackSlotIdSchema.parse(slotIdInput);
  if (!isVisualStylePackSlot(styleResult.data, slotId)) throw new AppError('Vị trí ảnh trong bộ phong cách không hợp lệ.', 400, 'INVALID_STYLE_PACK_SLOT');
  return { styleId: styleResult.data, slotId };
}

export function createVisualStylePacksService(filesDir: string) {
  const legacySamples = createVisualStyleSamplesService(filesDir);

  async function listPacks(): Promise<VisualStylePacks> {
    const result: VisualStylePacks = Object.fromEntries(VISUAL_STYLE_IDS.map((styleId) => [styleId, {}]));
    for (const doc of await collection().find().toArray()) {
      if (!isVisualStylePackSlot(doc.styleId, doc.slotId)) continue;
      result[doc.styleId]![doc.slotId] = entry(doc);
    }
    const legacy = await legacySamples.listSamples();
    for (const styleId of VISUAL_STYLE_IDS) {
      if (!result[styleId]?.core && legacy[styleId]) result[styleId]!.core = legacy[styleId];
    }
    return VisualStylePacksSchema.parse(result);
  }

  async function storeImage(styleId: VisualStyleId, slotId: string, file: Express.Multer.File): Promise<VisualStyleSample> {
    await mkdir(filesDir, { recursive: true });
    const storedPath = `${newId()}.${extensionFor('', file.mimetype)}`;
    await writeFile(path.join(filesDir, storedPath), file.buffer);
    const next: VisualStylePackImageDoc = {
      _id: `${styleId}:${slotId}`, styleId, slotId, storedPath,
      mimeType: file.mimetype, originalName: file.originalname, createdAt: new Date(),
    };
    let previous: VisualStylePackImageDoc | null;
    try {
      previous = await collection().findOneAndReplace({ _id: next._id }, next, { upsert: true, returnDocument: 'before' });
    } catch (error) {
      await unlink(path.join(filesDir, storedPath)).catch(() => undefined);
      throw error;
    }
    if (previous) await unlink(path.join(filesDir, previous.storedPath)).catch(() => undefined);
    if (slotId === 'core') await legacySamples.deleteSample(styleId);
    return entry(next);
  }

  async function deleteImage(styleId: VisualStyleId, slotId: string): Promise<void> {
    const previous = await collection().findOneAndDelete({ _id: `${styleId}:${slotId}` });
    if (previous) await unlink(path.join(filesDir, previous.storedPath)).catch(() => undefined);
    if (slotId === 'core') await legacySamples.deleteSample(styleId);
  }

  return { listPacks, storeImage, deleteImage };
}

let configuredService = createVisualStylePacksService('./data/files');
export function configureVisualStylePacks(filesDir: string): void { configuredService = createVisualStylePacksService(filesDir); }

export const visualStylePacksRouter = Router();
visualStylePacksRouter.get('/', async (_req, res) => { res.json(await configuredService.listPacks()); });
visualStylePacksRouter.put('/:styleId/:slotId', uploadReference, async (req, res) => {
  const { styleId, slotId } = validateSlot(req.params.styleId, req.params.slotId);
  const file = req.file;
  if (!file) throw new AppError('File is required.', 400, 'FILE_REQUIRED');
  if (!(STYLE_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) throw new AppError('File type not supported.', 400, 'INVALID_FILE_TYPE');
  res.json(await configuredService.storeImage(styleId, slotId, file));
});
visualStylePacksRouter.delete('/:styleId/:slotId', async (req, res) => {
  const { styleId, slotId } = validateSlot(req.params.styleId, req.params.slotId);
  await configuredService.deleteImage(styleId, slotId);
  res.status(204).end();
});
