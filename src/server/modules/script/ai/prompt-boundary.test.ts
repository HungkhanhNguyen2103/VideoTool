import { describe, expect, it } from 'vitest';
import { ProjectDetailSchema } from '../../../../contracts/project';
import { ChapterDocSchema } from '../../../../contracts/script';
import { loadScriptPreset } from './presets/loader';
import { SCRIPT_PRESET_CONFIG } from './presets/config';
import { buildChapterExpansionPrompt, buildManualScriptPrompt, buildOutlinePrompt, buildRegenerationPrompt, buildScriptPrompt, buildVisualPromptPrompt } from './build-prompt';
import { parseChapterExpansion, parseGeneratedChapters, parseManualScriptDocument, parseRegeneratedParagraphs, parseScriptOutline, parseVisualPromptBatch } from './parse-output';

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

  it('keeps documentary and explainer guidance mechanically distinct', () => {
    const documentary = buildScriptPrompt({ ...project, scriptPresetId: 'documentary' });
    const explainer = buildScriptPrompt({ ...project, scriptPresetId: 'explainer' });

    expect(documentary.system).toContain('open a chapter with a hook');
    expect(documentary.system).not.toContain('one self-contained beat');
    expect(explainer.system).toContain('one self-contained beat');
    expect(explainer.system).not.toContain('open a chapter with a hook');
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

  it('carries the selected explainer preset version into regeneration', () => {
    const result = buildRegenerationPrompt({ ...project, scriptPresetId: 'explainer' }, chapter, 'Clarify this', 'rewrite');
    expect(result.promptVersion).toBe('script-prompt-v1/explainer@1');
    expect(result.system).toContain(loadScriptPreset('explainer').instructions);
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
  it('parses an outline with chapter metadata and open loops', () => {
    const result = parseScriptOutline(JSON.stringify({
      chapters: [{ no: 1, title: 'Origins', role: 'hook', beat: 'Open with a mystery', targetWords: 300, endsOnTension: true }],
      openLoops: [{ question: 'What happened?', plantedInChapter: 1, resolvedInChapter: 1 }],
      coreQuestion: 'Question',
      openingHook: 'Hook',
    }), 'documentary');
    expect(result.chapters[0]!.targetWords).toBe(300);
  });

  it('requires the four hubris motif fields and rejects motif for other presets', () => {
    const motif = { hunter: 'A rival', perfectPlan: 'A flawless scheme', blindSpot: 'Arrogance', selfDestruction: 'The scheme turns inward' };
    const chapter = { no: 1, title: 'Origins', role: 'hook', beat: 'Mystery', targetWords: 10, endsOnTension: false };
    expect(parseScriptOutline(JSON.stringify({ chapters: [chapter], openLoops: [], coreQuestion: 'Question', openingHook: 'Hook', motif }), 'hubris-trap')).toMatchObject({ motif });
    expect(() => parseScriptOutline(JSON.stringify({ chapters: [chapter], openLoops: [], coreQuestion: 'Question', openingHook: 'Hook' }), 'hubris-trap')).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
    expect(() => parseScriptOutline(JSON.stringify({ chapters: [chapter], openLoops: [], coreQuestion: 'Question', openingHook: 'Hook', motif }), 'documentary')).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
  });

  it('parses expansion and manual document as distinct response shapes', () => {
    expect(parseChapterExpansion('{"paragraphs":["Expanded scene"],"styleNote":"Muted palette","chapterSummary":"Summary","avoidRepeating":[],"persistentFactsNext":[]}')).toEqual({ paragraphs: ['Expanded scene'], styleNote: 'Muted palette', chapterSummary: 'Summary', avoidRepeating: [], persistentFactsNext: [] });
    expect(parseManualScriptDocument(JSON.stringify({
      chapters: [{ no: 1, title: 'Origins', role: 'hook', beat: 'Mystery', targetWords: 2, endsOnTension: false, paragraphs: ['Expanded scene'] }],
      openLoops: [], coreQuestion: 'Question', openingHook: 'Hook',
    }), 'explainer').chapters[0]!.paragraphs).toEqual(['Expanded scene']);
    expect(() => parseChapterExpansion(JSON.stringify({ paragraphs: ['x'], styleNote: 'x'.repeat(501) }))).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
    expect(() => parseManualScriptDocument('{"paragraphs":["x"]}', 'explainer')).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
  });

  it.each(['chapterSummary', 'avoidRepeating', 'persistentFactsNext'] as const)('rejects chapter expansion missing %s with SCRIPT_PARSE_ERROR', (field) => {
    const expansion = { paragraphs: ['Expanded scene'], styleNote: 'Muted palette', chapterSummary: 'Summary', avoidRepeating: [], persistentFactsNext: [] };
    delete expansion[field];
    expect(() => parseChapterExpansion(JSON.stringify(expansion))).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR', status: 422 }));
  });

  it('builds the three new prompt shapes with their required inputs', () => {
    const outline = buildOutlinePrompt(project);
    expect(outline.user).toContain('Total narration word budget: 300 words');
    expect(outline.user).toContain('exactly 2 chapters');
    expect(outline.system).toContain('five-act');

    const expansion = buildChapterExpansionPrompt({ project, chapter: { ...chapter, role: 'hook', beat: 'Open a mystery', targetWords: 300, endsOnTension: true }, coreQuestion: 'Why did it happen?', openingHook: 'It began at dawn.', previousChapterSummary: null, previousAvoidRepeating: [], previousPersistentFacts: [], openLoops: ['What happens next?'], styleNote: 'Muted palette' });
    expect(expansion.user).toContain('Target words: 300');
    expect(expansion.user).toContain('What happens next?');
    expect(expansion.user).toContain('Muted palette');
    expect(expansion.system).toContain('paragraphs');

    const manual = buildManualScriptPrompt(project);
    expect(manual.system).toContain('paragraphs');
    expect(manual.user).toContain('complete script document');
    expect(manual.system).not.toBe(manual.user);
  });

  it('keeps hubris-trap outline guidance distinct from flatter explainer weighting', () => {
    const hubris = buildOutlinePrompt({ ...project, scriptPresetId: 'hubris-trap' });
    const explainer = buildOutlinePrompt({ ...project, scriptPresetId: 'explainer' });

    expect(hubris.system).toContain('hunter, perfectPlan, blindSpot, and selfDestruction');
    expect(hubris.system).toContain('8% / 15% / 55% / 12% / 10%');
    expect(explainer.system).toContain('flatter explanatory progression');
    expect(explainer.system).not.toContain('8% / 15% / 55% / 12% / 10%');
  });

  it('uses configured soft, strict, and no act-weighting guidance for outline prompts', () => {
    const ratio = `${SCRIPT_PRESET_CONFIG.documentary.actWeighting!.join('% / ')}%`;
    const documentary = buildOutlinePrompt({ ...project, scriptPresetId: 'documentary' });
    const hubris = buildOutlinePrompt({ ...project, scriptPresetId: 'hubris-trap' });
    const explainer = buildOutlinePrompt({ ...project, scriptPresetId: 'explainer' });

    expect(documentary.system).toContain(ratio);
    expect(documentary.system).toContain('guideline');
    expect(hubris.system).toContain(ratio);
    expect(hubris.system).toContain('requirement');
    expect(explainer.system).toContain('flatter explanatory progression');
    expect(explainer.system).not.toContain(ratio);
  });

  it.each(['coreQuestion', 'openingHook'] as const)('rejects an outline missing %s with SCRIPT_PARSE_ERROR', (field) => {
    const outline = {
      chapters: [{ no: 1, title: 'Origins', role: 'hook', beat: 'Mystery', targetWords: 10, endsOnTension: false }],
      openLoops: [], coreQuestion: 'Question', openingHook: 'Hook',
    };
    delete outline[field];
    expect(() => parseScriptOutline(JSON.stringify(outline), 'documentary')).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR', status: 422 }));
  });
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
