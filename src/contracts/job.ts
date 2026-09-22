import { z } from 'zod';

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JobSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  projectId: z.string(),
  status: z.enum(JOB_STATUSES),
  progress: z.number().min(0).max(100),
  error: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;
