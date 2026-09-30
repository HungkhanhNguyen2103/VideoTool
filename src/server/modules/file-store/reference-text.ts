import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export const REFERENCE_DOCUMENT_EXTENSIONS = ['txt', 'md', 'docx', 'pdf'] as const;
export const REFERENCE_DOCUMENT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
] as const;

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function isReferenceDocument(name: string, mimeType = ''): boolean {
  return (REFERENCE_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension(name))
    || (REFERENCE_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType);
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text;
}

export async function extractReferenceText(name: string, mimeType: string, buffer: Buffer): Promise<string> {
  const ext = extension(name);
  if (ext === 'txt' || ext === 'md' || mimeType === 'text/plain' || mimeType === 'text/markdown') return buffer.toString('utf8');
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return extractDocx(buffer);
  if (ext === 'pdf' || mimeType === 'application/pdf') return extractPdf(buffer);
  throw new Error('Unsupported reference document type.');
}
