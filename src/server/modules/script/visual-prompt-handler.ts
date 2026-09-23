import { z } from 'zod';
import { generateVisualPrompts, type VisualPromptJobContext, type VisualPromptJobResult } from './visual-prompts';

const VisualPromptJobPayloadSchema = z.object({ projectId: z.string().min(1) });
export type VisualPromptJobPayload = z.infer<typeof VisualPromptJobPayloadSchema>;

export async function handleGenerateVisualPrompts(
  job: { payload: unknown },
  context: VisualPromptJobContext,
): Promise<VisualPromptJobResult | void> {
  if (await context.isCancelled()) return;
  const payload = VisualPromptJobPayloadSchema.parse(job.payload);
  return generateVisualPrompts(payload.projectId, context);
}
