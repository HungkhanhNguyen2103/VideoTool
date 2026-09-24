import { z } from 'zod';
import { runFinalQa, type FinalQaJobContext } from './qa';
import type { QAResult } from './ai/qa-schema';

export const FinalQaJobPayloadSchema = z.object({ projectId: z.string().min(1) }).strict();
export type FinalQaJobPayload = z.infer<typeof FinalQaJobPayloadSchema>;

export async function handleFinalQa(
  job: { payload: unknown },
  context: FinalQaJobContext,
): Promise<QAResult | undefined> {
  if (await context.isCancelled()) return undefined;
  const payload = FinalQaJobPayloadSchema.parse(job.payload);
  return runFinalQa(payload.projectId, context);
}
