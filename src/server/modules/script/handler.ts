import { z } from 'zod';
import { GenerateScriptRequestSchema } from '../../../contracts/script';
import { loadConfig } from '../../config';
import { createClaudeCliScriptBackend } from './cli-script-backend';
import { generateScript, type ScriptGenerationJobContext } from './service';

export const ScriptJobPayloadSchema = z.object({ projectId: z.string().min(1) }).merge(GenerateScriptRequestSchema).strict();
export type ScriptJobPayload = z.infer<typeof ScriptJobPayloadSchema>;

type ScriptJob = { payload: unknown };

export const handleGenerateScript = async (job: ScriptJob, context: ScriptGenerationJobContext): Promise<void> => {
  if (await context.isCancelled()) return;
  const payload = ScriptJobPayloadSchema.parse(job.payload);
  const backend = payload.backend === 'cli'
    ? await createClaudeCliScriptBackend({
      projectId: payload.projectId,
      model: payload.cliModel ?? undefined,
      config: loadConfig(),
      context,
    })
    : undefined;
  try {
    await generateScript(payload.projectId, context, {
      ...(payload.resume ? { resume: true } : {}),
      ...(backend ? { backend } : {}),
    });
  } catch (error) {
    if (await context.isCancelled()) return;
    throw error;
  }
};
