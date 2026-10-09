import { describe, expect, it } from 'vitest';
import type { ScriptPresetId } from '../../../contracts/project';
import type { OpenLoop } from '../../../contracts/script';
import { analyzeScriptQuality, formatQualityReport, summarizeManualScriptQuality, type ScriptQualityInput } from './quality';

function chapter(
  no: number,
  role: 'hook' | 'context' | 'rising' | 'climax' | 'resolution',
  paragraphs: string[],
  sourceFacts?: string[],
) {
  return {
    id: `chapter-${no}`,
    no,
    title: `Chapter ${no}`,
    role,
    beat: '',
    targetWords: 100,
    paragraphs,
    sourceFacts,
  };
}

function project(overrides: Partial<ScriptQualityInput> = {}): ScriptQualityInput {
  return {
    id: 'quality-project',
    title: 'Quality fixture',
    brief: 'Nguyễn Huệ crossed the river in 1776.',
    referencesText: 'Nguyễn Huệ crossed the river in 1776.',
    scriptPresetId: 'documentary',
    targetDurationSec: 80,
    chapters: [
      chapter(1, 'hook', [
        'The river carried the army toward the narrow pass before dawn as the silent villages waited beside the water.',
        'In 2045 the fleet arrived.',
      ]),
      chapter(2, 'context', [
        'The river carried the army toward the narrow pass before sunrise as the silent villages waited beside the water.',
        'Nguyễn Huệ crossed the river in 1776.',
      ]),
    ],
    openLoops: [],
    ...overrides,
  };
}

describe('analyzeScriptQuality', () => {
  it('reports project and per-chapter length accuracy and estimated narration duration', () => {
    const report = analyzeScriptQuality(project());

    expect(report.length).toMatchObject({
      targetWords: 200,
      totalWords: 50,
      differenceWords: -150,
      deviationPct: -75,
      estimatedDurationSec: 20,
    });
    expect(report.length.maxChapterDeviationPct).toBe(76);
    expect(report.length.chapters.map(({ no, words, targetWords }) => ({ no, words, targetWords }))).toEqual([
      { no: 1, words: 24, targetWords: 100 },
      { no: 2, words: 26, targetWords: 100 },
    ]);
  });

  it('finds unsupported numbers and proper-name phrases with paragraph locations', () => {
    const report = analyzeScriptQuality(project());

    expect(report.grounding.candidateCount).toBeGreaterThan(0);
    expect(report.grounding.unsupported).toContainEqual(expect.objectContaining({
      token: '2045',
      chapterNo: 1,
      paragraphNo: 2,
    }));
    expect(report.grounding.unsupportedShare).toBeGreaterThan(0);
    expect(report.grounding.unsupported).not.toContainEqual(expect.objectContaining({ token: '1776' }));
    expect(report.grounding.unsupported).not.toContainEqual(expect.objectContaining({ token: 'Nguyễn Huệ' }));
  });

  it('counts cross-chapter repeated six-grams, repeated paragraph openers, and near-duplicate paragraphs', () => {
    const report = analyzeScriptQuality(project());

    expect(report.repetition.repeatedSixGrams).toContainEqual(expect.objectContaining({
      phrase: expect.stringContaining('river carried the army'),
      chapterNos: [1, 2],
    }));
    expect(report.repetition.repeatedParagraphOpeners).toContainEqual(expect.objectContaining({
      opener: 'the river carried the army toward',
      chapterNos: [1, 2],
    }));
    expect(report.repetition.nearDuplicateParagraphs[0]?.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('measures hubris act shares using preset roles and locates loop terms', () => {
    const openLoops: OpenLoop[] = [{ question: 'Will the river army reach the capital?', plantedInChapter: 1, resolvedInChapter: 2 }];
    const report = analyzeScriptQuality(project({
      scriptPresetId: 'hubris-trap' as ScriptPresetId,
      openLoops,
    }));

    expect(report.arc.actShares).toHaveLength(5);
    expect(report.arc.actShares).toContainEqual(expect.objectContaining({ role: 'hook', targetPct: 8 }));
    expect(report.arc.loops[0]).toMatchObject({
      plantedInChapter: 1,
      resolvedInChapter: 2,
      mentionedChapterNos: [1, 2],
      plantedTermFound: true,
      resolvedTermFound: true,
    });
  });

  it('reports paragraph and sentence structure and source-fact key-term usage', () => {
    const longSentence = Array.from({ length: 31 }, (_, index) => `word${index}`).join(' ');
    const report = analyzeScriptQuality(project({
      chapters: [
        chapter(1, 'hook', [`${longSentence}. Nguyễn Huệ crossed the river.`, 'A second paragraph.'], ['Nguyễn Huệ crossed the river [1]']),
      ],
      targetDurationSec: 40,
    }));

    expect(report.structure.chapters[0]).toMatchObject({
      chapterNo: 1,
      paragraphCount: 2,
      longestSentenceWords: 31,
      sentencesOver30Words: 1,
      sentenceCount: 3,
    });
    expect(report.structure.sentencesOver30Share).toBeCloseTo(1 / 3);
    expect(report.sourceUsage).toEqual([{ chapterNo: 1, facts: 1, used: 1, share: 1 }]);
  });
});

describe('formatQualityReport', () => {
  it('formats stable JSON and Markdown without needing a database', () => {
    const report = analyzeScriptQuality(project());

    expect(JSON.parse(formatQualityReport(report, 'json'))).toEqual(report);
    expect(formatQualityReport(report, 'md')).toContain('Provider/model: unknown / unknown');
    expect(formatQualityReport(report, 'md')).toContain('Repeated cross-chapter 6-grams:');
  });
});

describe('summarizeManualScriptQuality', () => {
  it('reports short and long manual imports without blocking either one', () => {
    const base = {
      targetDurationSec: 60,
      scriptPresetId: 'documentary' as const,
      chapters: [
        { no: 1, title: 'One', role: 'hook' as const, targetWords: 75, paragraphs: ['short'] },
        { no: 2, title: 'Two', role: 'context' as const, targetWords: 75, paragraphs: ['also short'] },
      ],
    };
    const short = summarizeManualScriptQuality(base);
    const first = base.chapters[0]!;
    const second = base.chapters[1]!;
    const long = summarizeManualScriptQuality({
      ...base,
      chapters: [{ ...first, paragraphs: [Array.from({ length: 182 }, () => 'word').join(' ')] }, second],
    });

    expect(short.outsideLengthRange).toBe(true);
    expect(short.totalWords).toBe(3);
    expect(short.chapters[0]).toMatchObject({ words: 1, targetWords: 75, outsideLengthRange: true });
    expect(short.warnings).toContain('Total narration is outside 85–115% of the target word budget.');
    expect(long.outsideLengthRange).toBe(true);
    expect(long.totalWords).toBe(184);
    expect(long.warnings).toContain('Total narration is outside 85–115% of the target word budget.');
  });

  it('warns when planned words miss the budget and hubris act shares exceed tolerance', () => {
    const summary = summarizeManualScriptQuality({
      targetDurationSec: 60,
      scriptPresetId: 'hubris-trap',
      chapters: [
        { no: 1, title: 'One', role: 'hook', targetWords: 10, paragraphs: [Array.from({ length: 100 }, () => 'word').join(' ')] },
        { no: 2, title: 'Two', role: 'context', targetWords: 10, paragraphs: [Array.from({ length: 100 }, () => 'word').join(' ')] },
      ],
    });

    expect(summary.plannedBudgetWarning).toBe(true);
    expect(summary.actShares.find(({ role }) => role === 'hook')?.outsideTolerance).toBe(true);
    expect(summary.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Planned targetWords total'),
      expect.stringContaining('Act 1 (hook)'),
    ]));
  });
});
