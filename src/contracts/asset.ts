import { z } from 'zod';

export const ASSET_TYPES = ['image', 'video'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const FlowSceneExportSchema = z.object({
  sceneId: z.number().int().positive(),
  sceneNumber: z.number().int().positive(),
  title: z.string(),
  prompt: z.string(),
  assetType: z.enum(ASSET_TYPES),
});
export type FlowSceneExport = z.infer<typeof FlowSceneExportSchema>;
