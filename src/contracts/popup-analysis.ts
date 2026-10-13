import { z } from 'zod';

export const POPUP_DENSITIES = ['low', 'medium', 'high'] as const;
export const PopupDensitySchema = z.enum(POPUP_DENSITIES).default('low');
export type PopupDensity = (typeof POPUP_DENSITIES)[number];

export const POPUP_BACKENDS = ['api', 'cli'] as const;
export const PopupBackendSchema = z.enum(POPUP_BACKENDS);
export type PopupBackend = (typeof POPUP_BACKENDS)[number];

export const POPUP_KINDS = ['person', 'place', 'event', 'number', 'year', 'date'] as const;
export const PopupKindSchema = z.enum(POPUP_KINDS);
export type PopupKind = (typeof POPUP_KINDS)[number];

export const PopupPlanPopupSchema = z.object({
  kind: PopupKindSchema,
  anchor: z.string().trim().min(1),
  display: z.string().trim().min(1),
  importance: z.number().int().min(1).max(5),
  reason: z.string().trim().min(1),
  role: z.string().trim().optional(),
  evidence: z.string().trim().optional(),
  startSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().nonnegative(),
  status: z.enum(['kept', 'dropped']).default('kept'),
  dropReason: z.string().trim().nullable().default(null),
  pinned: z.boolean().default(false),
  suppressed: z.boolean().default(false),
}).strict();
export type PopupPlanPopup = z.infer<typeof PopupPlanPopupSchema>;

export const PopupPlanDropSchema = PopupPlanPopupSchema.extend({
  dropReason: z.string().trim().min(1),
  status: z.literal('dropped').default('dropped'),
}).strict();
export type PopupPlanDrop = z.infer<typeof PopupPlanDropSchema>;

export const PopupPlanSchema = z.union([
  z.object({
    narrationHash: z.string().min(1),
    audioFileId: z.string().min(1),
    provider: z.enum(['deepseek', 'claude']),
    model: z.string().min(1),
    backend: PopupBackendSchema,
    density: PopupDensitySchema,
    generatedAt: z.string().datetime(),
    needed: z.boolean(),
    reason: z.string().trim().min(1),
    popups: z.array(PopupPlanPopupSchema),
    dropped: z.array(PopupPlanDropSchema),
  }).strict(),
  z.null(),
]);
export type PopupPlan = Exclude<z.infer<typeof PopupPlanSchema>, null>;
