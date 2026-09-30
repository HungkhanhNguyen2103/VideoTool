import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { extractReferenceText, isReferenceDocument } from './reference-text';

const KODAK_SENTENCE = 'Những bức ảnh Kodak kể lại ký ức của một thời đã qua.';

async function fixtureBuffer(name: string): Promise<Buffer> {
  const encoded = await readFile(new URL(`./test-fixtures/${name}`, import.meta.url), 'utf8');
  return Buffer.from(encoded.replace(/\s+/g, ''), 'base64');
}

describe('reference document extraction', () => {
  it('accepts the supported reference document types', () => {
    expect(isReferenceDocument('notes.txt', 'text/plain')).toBe(true);
    expect(isReferenceDocument('notes.md', 'text/markdown')).toBe(true);
    expect(isReferenceDocument('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(isReferenceDocument('notes.pdf', 'application/pdf')).toBe(true);
    expect(isReferenceDocument('image.png', 'image/png')).toBe(false);
  });

  it('extracts plain text', async () => {
    await expect(extractReferenceText('notes.txt', 'text/plain', Buffer.from('  Hello  '))).resolves.toBe('  Hello  ');
  });

  it('extracts Vietnamese diacritics from real DOCX and PDF documents', async () => {
    const [docx, pdf] = await Promise.all([
      fixtureBuffer('kodak-reference.docx.b64'),
      fixtureBuffer('kodak-reference.pdf.b64'),
    ]);

    await expect(extractReferenceText('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx))
      .resolves.toContain(KODAK_SENTENCE);
    await expect(extractReferenceText('notes.pdf', 'application/pdf', pdf))
      .resolves.toContain(KODAK_SENTENCE);
  });
});
