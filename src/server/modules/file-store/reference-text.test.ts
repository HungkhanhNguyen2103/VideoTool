import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { deflateRawSync } from 'node:zlib';
import { extractReferenceText, isReferenceDocument } from './reference-text';

function docxBuffer(text: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`));
  return zip.toBuffer();
}

describe('reference document extraction', () => {
  it('accepts the supported reference document types', () => {
    expect(isReferenceDocument('notes.txt', 'text/plain')).toBe(true);
    expect(isReferenceDocument('notes.md', 'text/markdown')).toBe(true);
    expect(isReferenceDocument('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(isReferenceDocument('notes.pdf', 'application/pdf')).toBe(true);
    expect(isReferenceDocument('image.png', 'image/png')).toBe(false);
  });

  it('extracts plain text and docx paragraphs', () => {
    expect(extractReferenceText('notes.txt', 'text/plain', Buffer.from('  Hello  '))).toBe('  Hello  ');
    expect(extractReferenceText('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuffer('Hello world'))).toBe('Hello world');
  });

  it('extracts text operators from a simple PDF', () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nstream\n(Before) Tj\n( after) Tj\nendstream\nendobj\n%%EOF');
    expect(extractReferenceText('notes.pdf', 'application/pdf', pdf)).toContain('Before after');
  });

  it('extracts text operators from a Flate-compressed PDF stream', () => {
    const stream = deflateRawSync(Buffer.from('(Compressed Kodak note) Tj'));
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\nstream\n'), stream, Buffer.from('\nendstream\n%%EOF')]);
    expect(extractReferenceText('notes.pdf', 'application/pdf', pdf)).toContain('Compressed Kodak note');
  });
});
