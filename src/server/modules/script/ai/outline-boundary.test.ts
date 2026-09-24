import { describe, expect, it } from 'vitest';
import { countNarrationWords, estimateNarrationDurationSec, NARRATION_WORDS_PER_MINUTE } from '../../../../contracts/script';
import { parseScriptOutline, validateScriptOutlineChapterCount } from './parse-output';

const chapter = { no: 1, title: 'Origins', role: 'hook', beat: 'Mystery', targetWords: 10, endsOnTension: false };

describe('outline boundary', () => {
  it('enforces explicit and AI-selected chapter-count rules', () => {
    const outline = parseScriptOutline(JSON.stringify({ chapters: [chapter], openLoops: [], coreQuestion: 'Question', openingHook: 'Hook' }), 'documentary');
    expect(validateScriptOutlineChapterCount(outline, 1)).toBe(outline);
    expect(() => validateScriptOutlineChapterCount(outline, 2)).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
    expect(validateScriptOutlineChapterCount(outline, null)).toBe(outline);
  });

  it.each([0, 21])('rejects AI-selected chapter counts outside the allowed 1–20 range: %s', (count) => {
    const outline = count === 0
      ? { chapters: [] }
      : parseScriptOutline(JSON.stringify({ chapters: Array.from({ length: count }, (_, index) => ({ ...chapter, no: index + 1 })), openLoops: [], coreQuestion: 'Question', openingHook: 'Hook' }), 'documentary');
    expect(() => validateScriptOutlineChapterCount(outline, null)).toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
  });

  it('counts whitespace-delimited narration and estimates duration at 150 WPM', () => {
    expect(NARRATION_WORDS_PER_MINUTE).toBe(150);
    expect(countNarrationWords('  one\n two   three ')).toBe(3);
    expect(countNarrationWords('')).toBe(0);
    expect(estimateNarrationDurationSec('one')).toBe(1);
    expect(estimateNarrationDurationSec(Array.from({ length: 150 }, () => 'word').join(' '))).toBe(60);
  });
});
