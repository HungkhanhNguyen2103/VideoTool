import AdmZip from 'adm-zip';
import { inflateRawSync, inflateSync } from 'node:zlib';

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

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)));
}

function extractDocx(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('DOCX does not contain word/document.xml.');
  const xml = entry.getData().toString('utf8');
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((match) =>
    decodeXml([...((match[1] ?? '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))].map((part) => part[1] ?? '').join('')),
  );
  return paragraphs.join('\n');
}

function decodePdfLiteral(value: string): string {
  return value.replace(/\\([\\()nrt])/g, (_, escaped: string) => ({ '\\': '\\', '(': '(', ')': ')', n: '\n', r: '\r', t: '\t' }[escaped] ?? escaped));
}

function extractPdf(buffer: Buffer): string {
  const source = buffer.toString('latin1');
  const decodedStreams = [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap((match) => {
    const compressed = Buffer.from(match[1] ?? '', 'latin1');
    for (const inflate of [inflateRawSync, inflateSync]) {
      try { return [inflate(compressed).toString('latin1')]; } catch { /* Try the other PDF zlib wrapper. */ }
    }
    return [];
  }).join('\n');
  const textSource = `${source}\n${decodedStreams}`;
  const values: string[] = [];
  for (const match of textSource.matchAll(/\(((?:\\.|[^\\()])*)\)\s*T[Jj]/g)) values.push(decodePdfLiteral(match[1] ?? ''));
  for (const match of textSource.matchAll(/\[((?:\([^)]*\)\s*)+)\]\s*TJ/g)) {
    values.push([...((match[1] ?? '').matchAll(/\((?:\\.|[^\\()])*\)/g))].map((part) => decodePdfLiteral(part[0].slice(1, -1))).join(''));
  }
  return values.join(' ').replace(/\s+/g, ' ').trim();
}

export function extractReferenceText(name: string, mimeType: string, buffer: Buffer): string {
  const ext = extension(name);
  if (ext === 'txt' || ext === 'md' || mimeType === 'text/plain' || mimeType === 'text/markdown') return buffer.toString('utf8');
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return extractDocx(buffer);
  if (ext === 'pdf' || mimeType === 'application/pdf') return extractPdf(buffer);
  throw new Error('Unsupported reference document type.');
}
