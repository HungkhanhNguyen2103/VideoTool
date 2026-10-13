import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PopupPreset = { id: 'popup-analysis'; version: number; system: string; instructions: string };

export function resolvePopupPresetDirectory(moduleUrl = import.meta.url): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  return basename(moduleDirectory) === 'dist' ? join(moduleDirectory, 'presets') : moduleDirectory;
}

export function loadPopupPreset(directory = resolvePopupPresetDirectory()): PopupPreset {
  const markdown = readFileSync(join(directory, 'popup-analysis.md'), 'utf8');
  const frontmatter = /^---[ \t]*\r?\nid:[ \t]*([^\r\n]+)[ \t]*\r?\nversion:[ \t]*(\d+)[ \t]*\r?\n---[ \t]*\r?\n/iu.exec(markdown);
  if (!frontmatter || frontmatter[1]?.trim() !== 'popup-analysis') throw new Error('Invalid popup-analysis preset frontmatter.');
  const body = markdown.slice(frontmatter[0].length);
  const section = (heading: string): string => {
    const match = new RegExp(`(?:^|\\n)# ${heading}\\r?\\n([\\s\\S]*?)(?=\\r?\\n# |$)`).exec(body);
    if (!match?.[1]?.trim()) throw new Error(`Popup preset is missing ${heading}.`);
    return match[1].trim();
  };
  return { id: 'popup-analysis', version: Number(frontmatter[2]), system: section('System'), instructions: section('Instructions') };
}
