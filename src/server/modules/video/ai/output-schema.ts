import { z } from 'zod';
import { POPUP_KINDS, PopupKindSchema } from '../../../../contracts/popup-analysis';

export const PopupAiCandidateSchema = z.object({
  scene: z.number().int().positive(),
  kind: PopupKindSchema,
  anchor: z.string().trim().min(1),
  display: z.string().trim().min(1),
  importance: z.number().int().min(1).max(5),
  reason: z.string().trim().min(1),
  role: z.string().trim().optional(),
  evidence: z.string().trim().optional(),
}).strict();
export type PopupAiCandidate = z.infer<typeof PopupAiCandidateSchema>;

export const PopupAiVerdictSchema = z.object({
  scene: z.number().int().positive(),
  needed: z.boolean(),
  reason: z.string().trim().min(1),
  popups: z.array(PopupAiCandidateSchema),
}).strict().superRefine((value, ctx) => {
  if (!value.needed && value.popups.length > 0) ctx.addIssue({ code: 'custom', path: ['popups'], message: 'A not-needed scene must not include popups.' });
  for (const popup of value.popups) if (popup.scene !== value.scene) ctx.addIssue({ code: 'custom', path: ['popups'], message: 'Popup scene must match its verdict scene.' });
});
export type PopupAiVerdict = z.infer<typeof PopupAiVerdictSchema>;

export const PopupAiOutputSchema = z.object({ scenes: z.array(PopupAiVerdictSchema) }).strict();
export type PopupAiOutput = z.infer<typeof PopupAiOutputSchema>;

export { POPUP_KINDS };
