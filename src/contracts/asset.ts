import { z } from 'zod';

export const ASSET_TYPES = ['image', 'video'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const VideoDistributionRequestSchema = z.object({
  targetPercent: z.number().int().min(0).max(100),
});
export type VideoDistributionRequest = z.infer<typeof VideoDistributionRequestSchema>;

const VideoDistributionChangeSchema = z.object({
  sceneId: z.string(),
  sceneNumber: z.number().int().positive(),
  from: z.enum(ASSET_TYPES),
  to: z.enum(ASSET_TYPES),
});

export const VideoDistributionPreviewSchema = z.object({
  total: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  lockedCount: z.number().int().nonnegative(),
  changes: z.array(VideoDistributionChangeSchema),
  videoSceneNumbers: z.array(z.number().int().positive()),
  projectVersion: z.number().int(),
});
export type VideoDistributionPreview = z.infer<typeof VideoDistributionPreviewSchema>;

export const VideoDistributionApplyRequestSchema = VideoDistributionRequestSchema.extend({
  expectedVersion: z.number().int(),
});
export type VideoDistributionApplyRequest = z.infer<typeof VideoDistributionApplyRequestSchema>;

export const ImportAssetsResultSchema = z.object({
  updated: z.number().int().nonnegative(),
  skipped: z.array(z.string()),
  skippedInactive: z.number().int().nonnegative(),
});
export type ImportAssetsResult = z.infer<typeof ImportAssetsResultSchema>;

export const FlowSceneExportSchema = z.object({
  sceneId: z.number().int().positive(),
  sceneNumber: z.number().int().positive(),
  title: z.string(),
  prompt: z.string(),
  assetType: z.enum(ASSET_TYPES),
  motionPrompt: z.string(),
  referenceTags: z.array(z.string()).optional(),
});
export type FlowSceneExport = z.infer<typeof FlowSceneExportSchema>;
