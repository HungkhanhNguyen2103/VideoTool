import { z } from 'zod';

/** These string values are also used by the FFmpeg filter graph. */
export const SFX_VOLUME = '0.31622777' as const;
export const BGM_VOLUME = '0.1' as const;
export const SFX_VOLUME_NUMBER = Number(SFX_VOLUME);
export const BGM_VOLUME_NUMBER = Number(BGM_VOLUME);

export const RemotionScenePropsSchema = z.object({
  id: z.string(),
  assetType: z.enum(['image', 'video']),
  assetRelPath: z.string().min(1),
  voiceRelPath: z.string().min(1).nullable(),
  sfxRelPath: z.string().min(1).nullable(),
  durationSec: z.number().nonnegative(),
  keywords: z.array(z.object({
    text: z.string().min(1),
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
  })).default([]),
});
export type RemotionSceneProps = z.infer<typeof RemotionScenePropsSchema>;

export const RemotionInputPropsSchema = z.object({
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scenes: z.array(RemotionScenePropsSchema),
  bgmRelPath: z.string().min(1).nullable(),
});
export type RemotionInputProps = z.infer<typeof RemotionInputPropsSchema>;
