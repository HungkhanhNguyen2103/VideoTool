import { z } from 'zod';

export const FileDocSchema = z.object({
  _id: z.string(),
  projectId: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  ext: z.string(),
  sizeBytes: z.number().int(),
  purpose: z.literal('reference'),
  storedPath: z.string(),
  createdAt: z.date(),
});
export type FileDoc = z.infer<typeof FileDocSchema>;
