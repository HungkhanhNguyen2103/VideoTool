import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { parseProjectImportSeed } from './project-import';

function zipWith(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, value] of Object.entries(entries)) zip.addFile(name, Buffer.from(value));
  return zip.toBuffer();
}

describe('project import seed parsing', () => {
  it('parses the project subset and appends sorted reference documents', async () => {
    const buffer = zipWith({
      'project.json': JSON.stringify({ title: 'Kodak', brief: 'A valid brief here', renderSettings: { aspect: '9:16', fps: 24 } }),
      'references/z-last.txt': 'Last note',
      'references/a-first.md': 'First note',
    });
    await expect(parseProjectImportSeed(buffer)).resolves.toEqual({
      title: 'Kodak', brief: 'A valid brief here', renderSettings: { aspect: '9:16', fps: 24 },
      referencesText: 'First note\n\nLast note',
    });
  });

  it('accepts a partial project.json and returns no references when absent', async () => {
    await expect(parseProjectImportSeed(zipWith({ 'project.json': '{"title":"Only title"}' }))).resolves.toEqual({ title: 'Only title' });
  });

  it('rejects a missing or invalid project.json', async () => {
    await expect(parseProjectImportSeed(zipWith({}))).rejects.toThrow(/project\.json/);
    await expect(parseProjectImportSeed(zipWith({ 'project.json': '{"unknown":true}' }))).rejects.toThrow();
  });
});
