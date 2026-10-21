import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../../shared/errors';

export type SeoPreset = { id: 'seo-documentary'; version: number; system: string; instructions: string; thumbnailTemplate: string };

export function resolveSeoPresetDirectory(moduleUrl = import.meta.url): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  return basename(moduleDirectory) === 'dist' ? join(moduleDirectory, 'presets') : moduleDirectory;
}

function invalidPreset(message: string): AppError {
  return new AppError(`Invalid SEO preset: ${message}`, 500, 'SEO_PRESET_INVALID');
}

export function loadSeoPreset(presetDirectory = resolveSeoPresetDirectory()): SeoPreset {
  let markdown: string;
  try {
    markdown = readFileSync(join(presetDirectory, 'seo-documentary.md'), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    throw invalidPreset('cannot read seo-documentary.md');
  }

  const frontmatter = /^---\r?\nid: ([^\r\n]+)\r?\nversion: ([^\r\n]+)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!frontmatter) throw invalidPreset('malformed frontmatter');
  if (frontmatter[1] !== 'seo-documentary') throw invalidPreset(`unknown declared ID "${frontmatter[1]}"`);
  if (!/^[1-9][0-9]*$/.test(frontmatter[2]!)) throw invalidPreset('version must be a positive integer');

  const body = markdown.slice(frontmatter[0].length);
  const extractSection = (name: 'System' | 'Instructions' | 'Thumbnail template'): string => {
    const match = new RegExp(`(?:^|\\n)## ${name}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`).exec(body);
    const section = match?.[1]?.trim();
    if (!section) throw invalidPreset(`missing or empty ## ${name} section`);
    return section;
  };

  const instructions = extractSection('Instructions');
  const sentinel = '[[THUMBNAIL_TEMPLATE]]';
  if (instructions.split(sentinel).length !== 2) throw invalidPreset('## Instructions must contain one thumbnail template sentinel');
  return {
    id: 'seo-documentary',
    version: Number(frontmatter[2]),
    system: extractSection('System'),
    instructions,
    thumbnailTemplate: extractSection('Thumbnail template'),
  };
}
