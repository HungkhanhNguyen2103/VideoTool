import { describe, expect, it } from 'vitest';
import { ProjectDetailSchema } from '../../../../contracts/project';
import { ChapterDocSchema } from '../../../../contracts/script';
import { loadScriptPreset } from './presets/loader';
import { buildRegenerationPrompt, buildScriptPrompt, buildVisualPromptPrompt } from './build-prompt';
import { parseGeneratedChapters, parseRegeneratedParagraphs, parseVisualPromptBatch } from './parse-output';

const project = ProjectDetailSchema.parse({
  id: 'project-1', title: 'River History', brief: 'Explain the history of the river.',
  status: 'draft', language: 'en', referencesText: 'Archive notes', scriptPresetId: 'documentary',
  targetDurationSec: 120, chapterCount: 2, voiceId: null,
  renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
  scenes: [], chapters: [], version: 1, createdAt: '2026-09-23', updatedAt: '2026-09-23',
});
const chapter = ChapterDocSchema.parse({ id: 'chapter-1', no: 1, title: 'Origins', paragraphs: ['First beat'], status: 'pending', scenesCount: null, durationSec: null });
const generated = [{ no: 1, title: 'Origins', paragraphs: ['First beat'], scenesCount: null, durationSec: null }];

describe('script AI prompt boundary', () => {
  it.each(['documentary', 'explainer'] as const)('composes the %s preset into initial prompt with metadata and version', (id) => {
    const input = { ...project, scriptPresetId: id };
    const preset = loadScriptPreset(id);
    const result = buildScriptPrompt(input);
    expect(result.promptVersion).toBe(`script-prompt-v1/${id}@${preset.version}`);
    expect(result.user).toContain(`Script preset: ${id}`);
    expect(result.system.indexOf('professional video script writer')).toBeLessThan(result.system.indexOf(preset.system));
    expect(result.system.indexOf(preset.system)).toBeLessThan(result.system.indexOf(preset.instructions));
    expect(result.system).toContain('JSON');
    for (const value of ['River History', 'Explain the history of the river.', 'Archive notes', 'English', '2', '120']) {
      expect(result.user).toContain(value);
    }
  });

  it('regenerates one chapter with preset guidance and no whole-project brief', () => {
    const result = buildRegenerationPrompt(project, chapter, 'Shorten this', 'light');
    expect(result.promptVersion).toBe('script-prompt-v1/documentary@2');
    expect(result.system).toContain(loadScriptPreset('documentary').instructions);
    expect(result.user).toContain('Origins');
    expect(result.user).toContain('First beat');
    expect(result.user).toContain('Shorten this');
    expect(result.user).toContain('light');
    expect(result.user).not.toContain(project.brief);
  });

  it('builds visual batch prompt with scene indexes but no internal IDs', () => {
    const result = buildVisualPromptPrompt({ project, chapter, styleNote: 'Muted colors', scenes: [{ sceneId: 'internal-id', sceneIndex: 1, narration: 'First beat', visualPrompt: 'Existing image' }] });
    expect(result.promptVersion).toBe('script-prompt-v1/documentary@2');
    expect(result.system).toContain(loadScriptPreset('documentary').system);
    expect(result.user).toContain('Muted colors');
    expect(result.user).toContain('This chapter contains exactly 1 scenes. Return exactly 1 prompt objects, one for every supplied sceneIndex. Echo each supplied sceneIndex exactly; do not invent, omit, duplicate, or renumber indexes.');
    expect(result.user).toContain('First beat');
    expect(result.user).toContain('Existing image');
    expect(result.user).toContain('1');
    expect(result.user).not.toContain('internal-id');
  });

  it('bounds a supplied continuity note before placing it in a visual batch prompt', () => {
    const result = buildVisualPromptPrompt({ project, chapter, styleNote: 'x'.repeat(501), scenes: [] });
    expect(result.user).toContain(`Previous style note: ${'x'.repeat(500)}\n\n`);
    expect(result.user).not.toContain('x'.repeat(501));
  });
});

describe('script AI parsers', () => {
  it.each([JSON.stringify(generated), `\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``])('accepts generated chapters in raw or fenced JSON', (raw) => {
    expect(parseGeneratedChapters(raw)).toEqual(generated);
  });
  it.each(['not json', '{}', JSON.stringify([{ ...generated[0], paragraphs: [] }])])('maps invalid chapter output to SCRIPT_PARSE_ERROR', (raw) => {
    expect(() => parseGeneratedChapters(raw)).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR', status: 422 }));
  });
  it.each(['["Updated"]', '{"paragraphs":["Updated"]}', '```json\n{"paragraphs":["Updated"]}\n```'])('accepts regenerated paragraphs', (raw) => {
    expect(parseRegeneratedParagraphs(raw)).toEqual(['Updated']);
  });
  it.each(['not json', '{"paragraphs":[]}', '{"paragraphs":[3]}'])('rejects invalid regenerated paragraphs', (raw) => {
    expect(() => parseRegeneratedParagraphs(raw)).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR', status: 422 }));
  });
  it.each(['{"styleNote":"Continuity","prompts":[{"sceneIndex":1,"visualPrompt":"Bridge at dawn"}]}', '```json\n{"styleNote":"Continuity","prompts":[{"sceneIndex":1,"visualPrompt":"Bridge at dawn"}]}\n```'])('accepts visual batches', (raw) => {
    expect(parseVisualPromptBatch(raw)).toEqual({ styleNote: 'Continuity', prompts: [{ sceneIndex: 1, visualPrompt: 'Bridge at dawn' }] });
  });
  it.each(['not json', '{"styleNote":"x","prompts":[{"sceneIndex":0,"visualPrompt":"view"}]}', '{"styleNote":"x","prompts":[{"sceneIndex":1,"visualPrompt":"   "}]}', JSON.stringify({ styleNote: 'x'.repeat(501), prompts: [{ sceneIndex: 1, visualPrompt: 'view' }] })])('rejects invalid visual batches', (raw) => {
    expect(() => parseVisualPromptBatch(raw)).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR', status: 422 }));
  });
});
