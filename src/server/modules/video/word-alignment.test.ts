import { describe, expect, it } from 'vitest';
import { alignNarrationWords, MIN_WORD_ALIGNMENT_MATCH_RATIO, type WhisperWord } from './word-alignment';

const whisper = (words: string[]): WhisperWord[] => words.map((word, index) => ({ word, start: index, end: index + 0.8, probability: 0.9 }));

describe('alignNarrationWords', () => {
  it('keeps narration spelling and punctuation, ignoring case and accents', () => {
    const result = alignNarrationWords('Đây là Kodak, ở Mỹ.', whisper(['day', 'la', 'kodak', 'o', 'my']), 5);
    expect(result.words?.map((word) => word.text)).toEqual(['Đây', 'là', 'Kodak,', 'ở', 'Mỹ.']);
    expect(result.words?.[2]).toEqual({ text: 'Kodak,', startSec: 2, endSec: 2.8 });
  });

  it('interpolates a digit over spoken-out number words while preserving neighbors', () => {
    const result = alignNarrationWords('Vào năm 2012 Kodak bắt đầu phá sản.', whisper(['vao', 'nam', 'hai', 'nghin', 'khong', 'tram', 'muoi', 'hai', 'kodak', 'bat', 'dau', 'pha', 'san']), 13);
    expect(result.words?.[1]).toMatchObject({ startSec: 1, endSec: 1.8 });
    expect(result.words?.[2]).toEqual({ text: '2012', startSec: 1.8, endSec: 8 });
    expect(result.words?.[3]).toMatchObject({ startSec: 8, endSec: 8.8 });
  });

  it('matches acronyms and foreign names, discarding an inserted transcript word', () => {
    const result = alignNarrationWords('CEO của Eastman Kodak đến New York.', whisper(['ceo', 'cua', 'eastman', 'kodak', 'da', 'den', 'new', 'york']), 8);
    expect(result.words?.map((word) => word.text)).toEqual(['CEO', 'của', 'Eastman', 'Kodak', 'đến', 'New', 'York.']);
    expect(result.words?.[4]).toMatchObject({ startSec: 5 });
  });

  it('accepts exactly 70% matches and rejects below 70%', () => {
    expect(MIN_WORD_ALIGNMENT_MATCH_RATIO).toBe(0.7);
    const tokens = 'a b c d e f g h i j';
    expect(alignNarrationWords(tokens, whisper(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 8).words).not.toBeNull();
    expect(alignNarrationWords(tokens, whisper(['a', 'b', 'c', 'd', 'e', 'f']), 8).words).toBeNull();
  });

  it.each([
    [[{ word: 'a', start: -0.1, end: 0.2, probability: 1 }], 1],
    [[{ word: 'a', start: 0, end: 0.8, probability: 1 }, { word: 'b', start: 0.7, end: 1, probability: 1 }], 2],
    [[{ word: 'a', start: 0, end: 1.1, probability: 1 }], 1],
  ])('rejects invalid raw timing spans', (words, duration) => {
    expect(alignNarrationWords('a b', words, duration).words).toBeNull();
  });
});
