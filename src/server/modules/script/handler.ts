import { z } from 'zod';
import { generateScript } from './service';

const ScriptJobPayloadSchema = z.object({ projectId: z.string().min(1) });
export type ScriptJobPayload = z.infer<typeof ScriptJobPayloadSchema>;

type ScriptJobContext = {
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

type ScriptJob = { payload: unknown };

export const handleGenerateScript = async (job: ScriptJob, context: ScriptJobContext): Promise<void> => {
  if (await context.isCancelled()) return;
  const payload = ScriptJobPayloadSchema.parse(job.payload);
  await generateScript(payload.projectId, context.appendLog);
};
