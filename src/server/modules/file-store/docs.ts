import { z } from 'zod';
import { FILE_PURPOSES } from '../../../contracts/file';

export const FileDocSchema = z.object({
  _id: z.string(),
  projectId: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  ext: z.string(),
  sizeBytes: z.number().int(),
  purpose: z.enum(FILE_PURPOSES),
  storedPath: z.string(),
  createdAt: z.date(),
});
export type FileDoc = z.infer<typeof FileDocSchema>;
