import { z } from 'zod';
import { JOB_STATUSES } from '../../../contracts/job';

/** The `jobs` collection. This schema is the single source of truth for queue documents. */
export const JobDocSchema = z.object({
  _id: z.string(),
  schemaVersion: z.literal(1),
  type: z.string(),
  projectId: z.string(),
  payload: z.unknown(),
  status: z.enum(JOB_STATUSES),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  runAt: z.date(),
  lockedBy: z.string().nullable(),
  lockedAt: z.date().nullable(),
  progress: z.number().min(0).max(100),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  cancelRequested: z.boolean(),
  logs: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type JobDoc = z.infer<typeof JobDocSchema>;
