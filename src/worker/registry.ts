import type { JobHandler } from '../server/modules/job';
import { handleGenerateScript } from '../server/modules/script';

export const jobHandlers: Record<string, JobHandler> = {
  'generate-script': handleGenerateScript,
};
