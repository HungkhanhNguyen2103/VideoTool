import type { JobDoc } from '../server/modules/job/docs';
import { newId } from '../server/shared/ids';

export function makeJob(overrides: Partial<JobDoc> = {}): JobDoc {
  const now = new Date();
  return {
    _id: newId(),
    schemaVersion: 1,
    type: 'example',
    projectId: 'project-1',
    payload: {},
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    runAt: now,
    lockedBy: null,
    lockedAt: null,
    progress: 0,
    result: null,
    error: null,
    cancelRequested: false,
    logs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
