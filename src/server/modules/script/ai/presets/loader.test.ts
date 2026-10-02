import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { loadScriptPreset, resolvePresetDirectory } from './loader.js';

const temporaryDirectories: string[] = [];

async function createPresetDirectory(contents: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'script-presets-'));
  temporaryDirectories.push(directory);
  await Promise.all(Object.entries(contents).map(([name, content]) =>
    writeFile(path.join(directory, name), content, 'utf8')));
  return directory;
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('loadScriptPreset', () => {
  it.each(['documentary', 'explainer', 'hubris-trap', 'strategist'] as const)('loads the %s preset with its authored sections', (id) => {
    const preset = loadScriptPreset(id as never);

    expect(preset.id).toBe(id);
    expect(Number.isInteger(preset.version)).toBe(true);
    expect(preset.version).toBeGreaterThan(0);
    expect(preset.system.trim()).not.toBe('');
    expect(preset.instructions.trim()).not.toBe('');
  });

  it('rejects an unknown requested preset before reading a file', () => {
    expect(() => loadScriptPreset('unknown' as never)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });

  it('rejects a frontmatter ID that differs from the requested preset', async () => {
    const directory = await createPresetDirectory({ 'documentary.md': '---\nid: explainer\nversion: 1\n---\n## System\nrole\n## Instructions\nrules' });

    expect(() => loadScriptPreset('documentary', directory)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });

  it.each(['0', '-1', '1.5', 'nope', '9'.repeat(400)])('rejects invalid version %s', async (version) => {
    const directory = await createPresetDirectory({ 'documentary.md': `---\nid: documentary\nversion: ${version}\n---\n## System\nrole\n## Instructions\nrules` });

    expect(() => loadScriptPreset('documentary', directory)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });

  it('rejects a preset missing a required section', async () => {
    const directory = await createPresetDirectory({ 'documentary.md': '---\nid: documentary\nversion: 1\n---\n## System\nrole' });

    expect(() => loadScriptPreset('documentary', directory)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });
});

describe('script preset packaging', () => {
  it('resolves presets beside source code and under dist for bundled server entries', () => {
    const root = path.resolve(import.meta.dirname, '../../../../../../');

    expect(resolvePresetDirectory()).toBe(path.dirname(import.meta.filename));
    expect(resolvePresetDirectory(new URL(`file:///${root.replaceAll('\\', '/')}/dist/server.js`).href))
      .toBe(path.join(root, 'dist/presets'));
  });

  it('copies root script presets and nested visual styles into dist and can run repeatedly', async () => {
    const root = path.resolve(import.meta.dirname, '../../../../../../');
    const script = path.join(root, 'scripts/copy-script-presets.mjs');
    const firstRun = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    expect(firstRun.status).toBe(0);

    const destination = path.join(root, 'dist/presets');
    const copied = await readdir(destination);
    expect(copied.sort()).toEqual(['documentary.md', 'explainer.md', 'hubris-trap.md', 'strategist.md', 'visual-styles']);
    expect(await readFile(path.join(destination, 'documentary.md'), 'utf8')).toContain('id: documentary');
    const visualStyles = await readdir(path.join(destination, 'visual-styles'));
    expect(visualStyles.sort()).toEqual(['anime.md', 'cinematic.md', 'flat-cartoon.md', 'photorealistic.md', 'strategic-map.md', 'watercolor.md']);
    expect(await readFile(path.join(destination, 'visual-styles/cinematic.md'), 'utf8')).toContain('id: cinematic');

    const secondRun = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    expect(secondRun.status).toBe(0);
  });
});
