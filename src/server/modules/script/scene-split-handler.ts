import { z } from 'zod';
import { splitProjectScenes, type SceneSplitJobContext, type SceneSplitJobResult } from './scene-split';

const SceneSplitJobPayloadSchema = z.object({ projectId: z.string().min(1) }).strict();
export type SceneSplitJobPayload = z.infer<typeof SceneSplitJobPayloadSchema>;

export async function handleSplitScenes(
  job: { payload: unknown },
  context: SceneSplitJobContext,
): Promise<SceneSplitJobResult | void> {
  if (await context.isCancelled()) return;
  const payload = SceneSplitJobPayloadSchema.parse(job.payload);
  return splitProjectScenes(payload.projectId, context);
}
