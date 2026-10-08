import { z } from 'zod';
import { generateScript, type ScriptGenerationJobContext } from './service';

const ScriptJobPayloadSchema = z.object({ projectId: z.string().min(1), resume: z.boolean().optional() });
export type ScriptJobPayload = z.infer<typeof ScriptJobPayloadSchema>;

type ScriptJob = { payload: unknown };

export const handleGenerateScript = async (job: ScriptJob, context: ScriptGenerationJobContext): Promise<void> => {
  if (await context.isCancelled()) return;
  const payload = ScriptJobPayloadSchema.parse(job.payload);
  if (payload.resume) await generateScript(payload.projectId, context, { resume: true });
  else await generateScript(payload.projectId, context);
};
