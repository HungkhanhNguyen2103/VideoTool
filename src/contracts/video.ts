import { z } from 'zod';
import { PARALLAX_STYLES, TRANSITION_STYLES } from './project';

/** These string values are also used by the FFmpeg filter graph. */
export const SFX_VOLUME = '0.31622777' as const;
export const BGM_VOLUME = '0.1' as const;
export const SFX_VOLUME_NUMBER = Number(SFX_VOLUME);
export const BGM_VOLUME_NUMBER = Number(BGM_VOLUME);

export const KEYWORD_KINDS = ['number', 'year', 'date', 'name'] as const;
export type KeywordKind = (typeof KEYWORD_KINDS)[number];

/** A narration-timed pop-up. Number/year kinds carry the data needed to animate them. */
export const RemotionKeywordSchema = z.object({
  text: z.string().min(1),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  kind: z.enum(KEYWORD_KINDS).default('name'),
  /** number: parsed value, decimal places, whether the narration used "." thousands grouping. */
  value: z.number().optional(),
  decimals: z.number().int().nonnegative().optional(),
  grouping: z.boolean().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  /** year/date: the calendar year mentioned. */
  year: z.number().int().optional(),
  /** year: the year the odometer rolls from, and the project-wide timeline range. */
  fromYear: z.number().int().optional(),
  timeline: z.object({ min: z.number(), max: z.number() }).optional(),
  nameRole: z.enum(['person', 'place']).optional(),
  subtitle: z.string().optional(),
});
export type RemotionKeyword = z.infer<typeof RemotionKeywordSchema>;

export const RemotionScenePropsSchema = z.object({
  id: z.string(),
  assetType: z.enum(['image', 'video']),
  assetRelPath: z.string().min(1),
  voiceRelPath: z.string().min(1).nullable(),
  sfxRelPath: z.string().min(1).nullable(),
  videoKeyframeRelPath: z.string().min(1).nullable().default(null),
  videoTailRelPath: z.string().min(1).nullable().default(null),
  videoDurationSec: z.number().positive().nullable().default(null),
  depthMapRelPath: z.string().min(1).nullable().default(null),
  durationSec: z.number().nonnegative(),
  filmLook: z.boolean().default(false),
  keywords: z.array(RemotionKeywordSchema).default([]),
});
export type RemotionSceneProps = z.infer<typeof RemotionScenePropsSchema>;

export const RemotionInputPropsSchema = z.object({
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scenes: z.array(RemotionScenePropsSchema),
  bgmRelPath: z.string().min(1).nullable(),
  transitionStyle: z.enum(TRANSITION_STYLES).default('varied'),
  parallax: z.enum(PARALLAX_STYLES).default('off'),
});
export type RemotionInputProps = z.infer<typeof RemotionInputPropsSchema>;
