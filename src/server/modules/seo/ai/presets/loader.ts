import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../../shared/errors';

export type SeoPreset = { id: 'seo-documentary'; version: number; system: string; instructions: string; thumbnailTemplate: string };
export type SeoShortsPreset = { id: 'seo-shorts'; version: number; system: string; instructions: string };

export function resolveSeoPresetDirectory(moduleUrl = import.meta.url): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  return basename(moduleDirectory) === 'dist' ? join(moduleDirectory, 'presets') : moduleDirectory;
}

function invalidPreset(message: string): AppError {
  return new AppError(`Invalid SEO preset: ${message}`, 500, 'SEO_PRESET_INVALID');
}

function readSeoPreset(id: SeoPreset['id'] | SeoShortsPreset['id'], presetDirectory: string): { id: string; version: number; body: string } {
  const filename = `${id}.md`;
  let markdown: string;
  try {
    markdown = readFileSync(join(presetDirectory, filename), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    throw invalidPreset(`cannot read ${filename}`);
  }

  const frontmatter = /^---\r?\nid: ([^\r\n]+)\r?\nversion: ([^\r\n]+)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!frontmatter) throw invalidPreset('malformed frontmatter');
  if (frontmatter[1] !== id) throw invalidPreset(`unknown declared ID "${frontmatter[1]}"`);
  if (!/^[1-9][0-9]*$/.test(frontmatter[2]!)) throw invalidPreset('version must be a positive integer');
  return { id, version: Number(frontmatter[2]), body: markdown.slice(frontmatter[0].length) };
}

function extractSection(body: string, name: string): string {
  const match = new RegExp(`(?:^|\\n)## ${name}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`).exec(body);
  const section = match?.[1]?.trim();
  if (!section) throw invalidPreset(`missing or empty ## ${name} section`);
  return section;
}

export function loadSeoPreset(presetDirectory = resolveSeoPresetDirectory()): SeoPreset {
  const preset = readSeoPreset('seo-documentary', presetDirectory);
  const instructions = extractSection(preset.body, 'Instructions');
  const sentinel = '[[THUMBNAIL_TEMPLATE]]';
  if (instructions.split(sentinel).length !== 2) throw invalidPreset('## Instructions must contain one thumbnail template sentinel');
  return {
    id: 'seo-documentary',
    version: preset.version,
    system: extractSection(preset.body, 'System'),
    instructions,
    thumbnailTemplate: extractSection(preset.body, 'Thumbnail template'),
  };
}

export function loadSeoShortsPreset(presetDirectory = resolveSeoPresetDirectory()): SeoShortsPreset {
  const preset = readSeoPreset('seo-shorts', presetDirectory);
  return {
    id: 'seo-shorts',
    version: preset.version,
    system: extractSection(preset.body, 'System'),
    instructions: extractSection(preset.body, 'Instructions'),
  };
}
