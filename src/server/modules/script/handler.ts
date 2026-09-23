import { z } from 'zod';
import { generateScript, type ScriptGenerationJobContext } from './service';

const ScriptJobPayloadSchema = z.object({ projectId: z.string().min(1) });
export type ScriptJobPayload = z.infer<typeof ScriptJobPayloadSchema>;

type ScriptJob = { payload: unknown };

export const handleGenerateScript = async (job: ScriptJob, context: ScriptGenerationJobContext): Promise<void> => {
  if (await context.isCancelled()) return;
  const payload = ScriptJobPayloadSchema.parse(job.payload);
  await generateScript(payload.projectId, context);
};
