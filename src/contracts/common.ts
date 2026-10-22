import { z } from 'zod';

/** Body of every non-2xx JSON response from the API. */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Present for validation errors: one entry per invalid field. */
    fields: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    /** Present when a conflict lets the client rejoin an existing job. */
    jobId: z.string().min(1).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
