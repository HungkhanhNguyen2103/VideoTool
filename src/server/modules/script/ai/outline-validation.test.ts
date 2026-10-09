import { describe, expect, it } from 'vitest';
import { ChapterDocSchema, ChapterSnapshotSchema, getReferenceCoverage } from '../../../../contracts/script';
import type { ScriptOutline } from './output-schema';
import {
  getManualOutlineWarnings,
  getOutlineOutputBudgets,
  inspectScriptOutline,
  recommendScriptChapterCount,
  validateScriptOutline,
} from './outline-validation';

const chapters: ScriptOutline['chapters'] = [
  { no: 1, title: 'Hook', role: 'hook', beat: 'Open the question.', targetWords: 80, endsOnTension: true, sourceFacts: ['The fleet arrived [1]'], holdBack: ['The ambush remains hidden.'] },
  { no: 2, title: 'Context', role: 'context', beat: 'Explain the stakes.', targetWords: 150, endsOnTension: true, sourceFacts: ['The river narrowed [1]'], holdBack: [] },
  { no: 3, title: 'Rising', role: 'rising', beat: 'Raise the pressure.', targetWords: 550, endsOnTension: true, sourceFacts: ['The river narrows [1]', 'The fleet advances [2]'] },
  { no: 4, title: 'Climax', role: 'climax', beat: 'Show the decisive move.', targetWords: 120, endsOnTension: true, sourceFacts: ['The trap closes [1]', 'The fleet retreats [2]'] },
  { no: 5, title: 'Resolution', role: 'resolution', beat: 'Answer the question.', targetWords: 100, endsOnTension: false, sourceFacts: ['The river is clear [1]', 'The archive records the result [2]'] },
];

const validOutline: ScriptOutline = {
  chapters: [...chapters],
  openLoops: [
    { question: 'Will the fleet cross the river?', plantedInChapter: 1, resolvedInChapter: 3 },
    { question: 'Who controls the river?', plantedInChapter: 2, resolvedInChapter: 4 },
  ],
  coreQuestion: 'Why did the fleet lose?',
  openingHook: 'At dawn, the river closes.',
  motif: { hunter: 'the fleet', perfectPlan: 'the route', blindSpot: 'the river', selfDestruction: 'the trap' },
};

const project = {
  targetDurationSec: 400,
  chapterCount: 5,
  referencesText: '[1] Archive A. [2] Archive B.',
  scriptPresetId: 'hubris-trap' as const,
};

describe('outline planning helpers', () => {
  it('recommends one chapter per about 2.5 minutes and clamps to 3–10', () => {
    expect(recommendScriptChapterCount(840)).toBe(6);
    expect(recommendScriptChapterCount(1)).toBe(3);
    expect(recommendScriptChapterCount(3600)).toBe(10);
  });

  it('allocates a chapter- and reference-scaled outline budget with one model-capped retry', () => {
    expect(getOutlineOutputBudgets(10, 5000, 32_000)).toEqual({
      estimatedFactSlots: 2,
      initial: 9000,
      retry: 13_500,
    });
    expect(getOutlineOutputBudgets(10, 5000, 10_000).retry).toBe(10_000);
    expect(getOutlineOutputBudgets(10, 0, 32_000).estimatedFactSlots).toBe(0);
  });

  it('accepts a contiguous outline with balanced hubris acts and valid loop placements', () => {
    expect(validateScriptOutline(validOutline, project)).toEqual([]);
    expect(inspectScriptOutline(validOutline, project)).toMatchObject({ errors: [], warnings: [] });
  });

  it('uses the recommended count when the project leaves chapterCount unset and checks source citation tags', () => {
    const recommendedProject = { ...project, targetDurationSec: 840, chapterCount: null };
    const recommendedOutline = {
      ...validOutline,
      chapters: Array.from({ length: 6 }, (_, index) => ({ ...validOutline.chapters[index % 5]!, no: index + 1, role: index < 3 ? 'rising' as const : validOutline.chapters[index % 5]!.role, targetWords: 350 })),
      openLoops: [
        { question: 'Where is the river?', plantedInChapter: 1, resolvedInChapter: 3 },
        { question: 'Who controls it?', plantedInChapter: 2, resolvedInChapter: 5 },
      ],
    };
    expect(inspectScriptOutline(recommendedOutline, recommendedProject).errors).not.toContain(expect.stringContaining('exactly 6 chapters'));

    const invalidCitation = { ...validOutline, chapters: validOutline.chapters.map((chapter, index) => index === 0 ? { ...chapter, sourceFacts: ['This fact cites a missing source [3]'] } : chapter) };
    expect(inspectScriptOutline(invalidCitation, project).errors)
      .toContain('Chapter 1 sourceFacts[0] must end with a source tag that exists in References (for example [1]).');
  });

  it('warns before generation when references provide fewer than 500 characters per target minute', () => {
    expect(getReferenceCoverage('x'.repeat(6999), 840)).toMatchObject({
      referenceCharacters: 6999,
      targetMinutes: 14,
      charactersPerMinute: 500,
      shouldWarn: false,
    });
    expect(getReferenceCoverage('x'.repeat(6990), 840)).toMatchObject({
      charactersPerMinute: 499,
      shouldWarn: true,
    });
  });

  it('reports the exact signed word-budget repair amount and percentage', () => {
    const tooShort = { ...validOutline, chapters: validOutline.chapters.map((chapter, index) => index === 2 ? { ...chapter, targetWords: 490 } : chapter) };
    const result = inspectScriptOutline(tooShort, project);

    expect(result.errors).toContain('targetWords total is 940; budget is 1,000 words (difference -60, -6.0%). Adjust the outline by exactly +60 words and keep the total within ±2% of budget.');
    expect(() => validateScriptOutline(tooShort, project)).toThrow(/difference -60, -6.0%.*exactly \+60 words/);
  });

  it('checks chapter numbering, loop count, loop order, and final-resolution placement', () => {
    const wrongNumbers = { ...validOutline, chapters: validOutline.chapters.map((chapter, index) => index === 2 ? { ...chapter, no: 4 } : chapter) };
    expect(inspectScriptOutline(wrongNumbers, project).errors).toContain('Chapter numbers must be contiguous from 1 through 5.');

    expect(inspectScriptOutline({ ...validOutline, openLoops: [validOutline.openLoops[0]!] }, project).errors)
      .toContain('Expected 2–3 open loops for 5 chapters; received 1.');
    expect(inspectScriptOutline({ ...validOutline, openLoops: [{ question: 'Too early', plantedInChapter: 3, resolvedInChapter: 2 }, validOutline.openLoops[1]!] }, project).errors)
      .toContain('Open loop 1 must be planted before it is resolved.');
    expect(inspectScriptOutline({ ...validOutline, openLoops: [{ question: 'Final reflection', plantedInChapter: 1, resolvedInChapter: 5 }, validOutline.openLoops[1]!] }, project).errors)
      .toEqual([]);
    expect(inspectScriptOutline({ ...validOutline, openLoops: [
      { question: 'First late loop', plantedInChapter: 1, resolvedInChapter: 5 },
      { question: 'Second late loop', plantedInChapter: 2, resolvedInChapter: 5 },
    ] }, project).errors).toContain('At most one final-reflection open loop may resolve in the last chapter.');
    expect(inspectScriptOutline({ ...validOutline, chapters: validOutline.chapters.map((chapter, index) => index === 4 ? { ...chapter, role: 'context' } : chapter), openLoops: [{ question: 'Late reveal', plantedInChapter: 1, resolvedInChapter: 5 }, validOutline.openLoops[1]!] }, project).errors)
      .toContain('An open loop resolved in the last chapter requires that chapter to have the resolution role.');
  });

  it('enforces hubris act shares within five percentage points and warns on chapter ceilings and thin sources', () => {
    const unbalanced = { ...validOutline, chapters: validOutline.chapters.map((chapter) => chapter.role === 'hook' ? { ...chapter, targetWords: 140 } : chapter.role === 'rising' ? { ...chapter, targetWords: 490 } : chapter) };
    expect(inspectScriptOutline(unbalanced, project).errors).toEqual(expect.arrayContaining([expect.stringContaining('Act 1 (hook) is 14.0%; target 8% ±5 pp.')]));

    const overCeiling = { ...validOutline, chapters: validOutline.chapters.map((chapter, index) => index === 0 ? { ...chapter, targetWords: 650, sourceFacts: [] } : chapter) };
    const warningResult = inspectScriptOutline(overCeiling, { ...project, scriptPresetId: 'documentary' });
    expect(warningResult.warnings).toEqual(expect.arrayContaining([
      'Chapter 1 target is 650 words, above the 600-word (4-minute) ceiling.',
      'Chapter 1 is thin-source: fewer than 2 source facts for a target above 150 words.',
    ]));
  });

  it('warns instead of retrying an impossible five-act target when fewer than five chapters are configured', () => {
    const shortHubris = {
      ...validOutline,
      chapters: [chapters[0]!, chapters[1]!, { ...chapters[2]!, targetWords: 770 }],
      openLoops: [{ question: 'What changed?', plantedInChapter: 1, resolvedInChapter: 2 }],
    };
    const result = inspectScriptOutline(shortHubris, { ...project, chapterCount: 3 });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain('The five hubris-trap act shares cannot all be represented with 3 chapters; strict ±5 pp validation is suspended below five chapters.');
  });

  it('returns manual budget and act-share issues as warnings instead of blocking import', () => {
    const manual = { ...validOutline, chapters: validOutline.chapters.map((chapter, index) => index === 0 ? { ...chapter, targetWords: 140 } : chapter.role === 'rising' ? { ...chapter, targetWords: 520 } : chapter) };
    const warnings = getManualOutlineWarnings(manual, project);

    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('targetWords total is 1,030; budget is 1,000 words'),
      expect.stringContaining('Act 1 (hook) is 13.6%; target 8% ±5 pp.'),
    ]));
    expect(() => getManualOutlineWarnings(manual, project)).not.toThrow();
  });
});

describe('additive chapter fields', () => {
  it('accepts legacy chapters and validates bounded source facts and hold-backs', () => {
    const legacy = ChapterDocSchema.parse({ id: 'legacy', no: 1, title: 'Legacy', paragraphs: [], status: 'pending', scenesCount: null, durationSec: null });
    expect(legacy.sourceFacts).toBeUndefined();
    expect(legacy.holdBack).toBeUndefined();

    expect(ChapterDocSchema.safeParse({ ...legacy, sourceFacts: Array.from({ length: 10 }, (_, index) => `Fact ${index} [1]`), holdBack: ['Reveal later'] }).success).toBe(true);
    expect(ChapterDocSchema.safeParse({ ...legacy, sourceFacts: Array.from({ length: 11 }, () => 'Fact [1]') }).success).toBe(false);
    expect(ChapterDocSchema.safeParse({ ...legacy, sourceFacts: ['x'.repeat(301)] }).success).toBe(false);
    expect(ChapterDocSchema.safeParse({ ...legacy, holdBack: Array.from({ length: 5 }, () => 'Later') }).success).toBe(false);
    expect(ChapterDocSchema.safeParse({ ...legacy, holdBack: ['x'.repeat(201)] }).success).toBe(false);

    const snapshot = ChapterSnapshotSchema.parse({ takenAt: new Date(), chapters: [{ ...legacy, sourceFacts: ['A [1]'], holdBack: ['B'] }] });
    expect(snapshot.chapters[0]).toMatchObject({ sourceFacts: ['A [1]'], holdBack: ['B'] });
  });
});
