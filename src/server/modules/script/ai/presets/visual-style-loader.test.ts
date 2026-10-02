import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadVisualStylePreset } from './visual-style-loader.js';

const temporaryDirectories: string[] = [];

async function createPresetDirectory(contents: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'visual-style-presets-'));
  temporaryDirectories.push(directory);
  await Promise.all(Object.entries(contents).map(([name, content]) => writeFile(path.join(directory, name), content, 'utf8')));
  return directory;
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('loadVisualStylePreset', () => {
  it.each(['cinematic', 'anime', 'watercolor', 'photorealistic', 'flat-cartoon', 'strategic-map'] as const)('loads the %s preset with its style directive', (id) => {
    const preset = loadVisualStylePreset(id as never);

    expect(preset.id).toBe(id);
    expect(Number.isInteger(preset.version)).toBe(true);
    expect(preset.version).toBeGreaterThan(0);
    expect(preset.style.trim()).not.toBe('');
  });

  it('rejects an unknown requested style before reading a file', () => {
    expect(() => loadVisualStylePreset('unknown' as never)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });

  it('rejects a mismatched declared ID', async () => {
    const directory = await createPresetDirectory({ 'cinematic.md': '---\nid: anime\nversion: 1\n---\n## Style\nstyle' });

    expect(() => loadVisualStylePreset('cinematic', directory)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });

  it('rejects malformed frontmatter', async () => {
    const directory = await createPresetDirectory({ 'cinematic.md': 'not frontmatter\n## Style\nstyle' });

    expect(() => loadVisualStylePreset('cinematic', directory)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });

  it.each(['0', '-1', '1.5', 'nope'])('rejects invalid version %s', async (version) => {
    const directory = await createPresetDirectory({ 'cinematic.md': `---\nid: cinematic\nversion: ${version}\n---\n## Style\nstyle` });

    expect(() => loadVisualStylePreset('cinematic', directory)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });

  it('rejects a missing or empty style section', async () => {
    const missing = await createPresetDirectory({ 'cinematic.md': '---\nid: cinematic\nversion: 1\n---\n## Other\nstyle' });
    const empty = await createPresetDirectory({ 'cinematic.md': '---\nid: cinematic\nversion: 1\n---\n## Style\n' });

    expect(() => loadVisualStylePreset('cinematic', missing)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
    expect(() => loadVisualStylePreset('cinematic', empty)).toThrow(expect.objectContaining({ code: 'SCRIPT_PRESET_INVALID' }));
  });
});
