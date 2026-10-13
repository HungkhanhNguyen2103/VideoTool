import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoots = ['src/server', 'src/client', 'src/contracts'];
const sourceExtensions = new Set(['.ts', '.tsx', '.md']);
const doubleEncodedVietnamese = new RegExp([
  `${String.fromCodePoint(0x00c3)}.`,
  String.fromCodePoint(0x00e1, 0x00ba),
  String.fromCodePoint(0x00e1, 0x00bb),
  `${String.fromCodePoint(0x00c4)}.`,
].join('|'), 'u');

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(filePath));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(filePath);
    }
  }
  return files;
}

describe('source encoding', () => {
  it('contains no double-encoded Vietnamese markers in application sources', async () => {
    const files = (await Promise.all(sourceRoots.map((root) => collectSourceFiles(path.resolve(root))))).flat();
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (doubleEncodedVietnamese.test(source)) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});
