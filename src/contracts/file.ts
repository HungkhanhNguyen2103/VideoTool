import { z } from 'zod';

export const FILE_PURPOSES = ['reference', 'style-reference', 'voiceover', 'sfx', 'bgm', 'render', 'depth'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const ALLOWED_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/wav',
  'audio/mpeg',
] as const;

export const FileSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  ext: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  purpose: z.enum(FILE_PURPOSES),
  storedPath: z.string(),
  createdAt: z.string(),
});
export type FileSummary = z.infer<typeof FileSummarySchema>;
