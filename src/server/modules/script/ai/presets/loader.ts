import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPT_PRESET_IDS, type ScriptPresetId } from '../../../../../contracts/project.js';
import { AppError } from '../../../../shared/errors.js';

export type ScriptPreset = {
  id: ScriptPresetId;
  version: number;
  system: string;
  instructions: string;
};

export function resolvePresetDirectory(moduleUrl = import.meta.url): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  return basename(moduleDirectory) === 'dist' ? join(moduleDirectory, 'presets') : moduleDirectory;
}

function invalidPreset(message: string): AppError {
  return new AppError(`Invalid script preset: ${message}`, 500, 'SCRIPT_PRESET_INVALID');
}

export function loadScriptPreset(
  id: ScriptPresetId,
  presetDirectory = resolvePresetDirectory(),
): ScriptPreset {
  if (!(SCRIPT_PRESET_IDS as readonly string[]).includes(id)) {
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
  if (!(SCRIPT_PRESET_IDS as readonly string[]).includes(declaredId)) {
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
  const extractSection = (name: 'System' | 'Instructions'): string => {
    const match = new RegExp(`(?:^|\\n)## ${name}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`).exec(body);
    const section = match?.[1]?.trim();
    if (!section) throw invalidPreset(`missing or empty ## ${name} section`);
    return section;
  };

  return {
    id,
    version,
    system: extractSection('System'),
    instructions: extractSection('Instructions'),
  };
}
