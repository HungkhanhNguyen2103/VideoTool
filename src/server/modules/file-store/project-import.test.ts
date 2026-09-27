import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { parseProjectImportSeed } from './project-import';

function zipWith(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, value] of Object.entries(entries)) zip.addFile(name, Buffer.from(value));
  return zip.toBuffer();
}

describe('project import seed parsing', () => {
  it('parses the project subset and appends sorted reference documents', () => {
    const buffer = zipWith({
      'project.json': JSON.stringify({ title: 'Kodak', brief: 'A valid brief here', renderSettings: { aspect: '9:16', fps: 24 } }),
      'references/z-last.txt': 'Last note',
      'references/a-first.md': 'First note',
    });
    expect(parseProjectImportSeed(buffer)).toEqual({
      title: 'Kodak', brief: 'A valid brief here', renderSettings: { aspect: '9:16', fps: 24 },
      referencesText: 'First note\n\nLast note',
    });
  });

  it('accepts a partial project.json and returns no references when absent', () => {
    expect(parseProjectImportSeed(zipWith({ 'project.json': '{"title":"Only title"}' }))).toEqual({ title: 'Only title' });
  });

  it('rejects a missing or invalid project.json', () => {
    expect(() => parseProjectImportSeed(zipWith({}))).toThrow(/project\.json/);
    expect(() => parseProjectImportSeed(zipWith({ 'project.json': '{"unknown":true}' }))).toThrow();
  });
});
