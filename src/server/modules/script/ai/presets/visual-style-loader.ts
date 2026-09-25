import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISUAL_STYLE_IDS, type VisualStyleId } from '../../../../../contracts/project.js';
import { AppError } from '../../../../shared/errors.js';

export type VisualStylePreset = {
  id: VisualStyleId;
  version: number;
  style: string;
};

function resolveVisualStyleDirectory(moduleUrl = import.meta.url): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  const presetDirectory = basename(moduleDirectory) === 'dist' ? join(moduleDirectory, 'presets') : moduleDirectory;
  return join(presetDirectory, 'visual-styles');
}

function invalidPreset(message: string): AppError {
  return new AppError(`Invalid visual style preset: ${message}`, 500, 'SCRIPT_PRESET_INVALID');
}

export function loadVisualStylePreset(
  id: VisualStyleId,
  presetDirectory = resolveVisualStyleDirectory(),
): VisualStylePreset {
  if (!(VISUAL_STYLE_IDS as readonly string[]).includes(id)) {
    throw invalidPreset(`unknown requested ID "${id}"`);
  }

  let markdown: string;
  try {
    markdown = readFileSync(join(presetDirectory, `${id}.md`), 'utf8');
  } catch {
    throw invalidPreset(`cannot read ${id}.md`);
  }

  const frontmatter = /^---\r?\nid: ([^\r\n]+)\r?\nversion: ([^\r\n]+)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!frontmatter) throw invalidPreset('malformed frontmatter');

  const declaredId = frontmatter[1]!;
  if (!(VISUAL_STYLE_IDS as readonly string[]).includes(declaredId)) {
    throw invalidPreset(`unknown declared ID "${declaredId}"`);
  }
  if (declaredId !== id) throw invalidPreset(`requested ID "${id}" does not match "${declaredId}"`);

  const versionText = frontmatter[2]!;
  if (!/^[1-9][0-9]*$/.test(versionText)) throw invalidPreset('version must be a positive integer');
  const version = Number(versionText);
  if (!Number.isFinite(version) || !Number.isInteger(version)) {
    throw invalidPreset('version must be a finite integer');
  }

  const body = markdown.slice(frontmatter[0].length);
  const match = /(?:^|\n)## Style\s*\r?\n([\s\S]*?)(?=\r?\n## |$)/.exec(body);
  const style = match?.[1]?.trim();
  if (!style) throw invalidPreset('missing or empty ## Style section');

  return { id, version, style };
}
