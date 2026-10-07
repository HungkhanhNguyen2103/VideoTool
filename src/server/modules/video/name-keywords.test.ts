import { describe, expect, it } from 'vitest';
import { validateNameCandidate, validateNameCandidates } from './name-keywords';
import type { TimedWord } from './keywords';

const words: TimedWord[] = [
  { text: 'Trên', startSec: 0, endSec: 0.2 },
  { text: 'sông', startSec: 0.2, endSec: 0.45 },
  { text: 'Tiền,', startSec: 0.45, endSec: 0.8 },
  { text: 'Nguyễn', startSec: 1, endSec: 1.3 },
  { text: 'Ánh', startSec: 1.3, endSec: 1.6 },
];

describe('AI name candidate validation', () => {
  it('matches a verbatim phrase case- and diacritic-insensitively and returns aligned indexes', () => {
    expect(validateNameCandidate('Trên sông Tiền, Nguyễn Ánh.', words, { phrase: 'SÔNG tien', kind: 'place' })).toMatchObject({
      accepted: true,
      startWordIndex: 1,
      endWordIndex: 2,
      startSec: 0.2,
      endSec: 0.8,
    });
  });

  it('rejects a phrase whose words are not contiguous in the timed word sequence', () => {
    const splitWords = [
      { text: 'Nguyễn', startSec: 0, endSec: 0.3 },
      { text: 'từng', startSec: 0.3, endSec: 0.5 },
      { text: 'Huệ', startSec: 0.5, endSec: 0.8 },
    ];
    expect(validateNameCandidate('Nguyễn Huệ.', splitWords, { phrase: 'Nguyễn Huệ', kind: 'person' })).toMatchObject({
      accepted: false,
      reason: 'not a contiguous timed-word run',
    });
  });

  it('rejects a phrase that is absent from the narration even if aligned words contain it', () => {
    const aligned = [{ text: 'Rạch', startSec: 0, endSec: 0.2 }, { text: 'Gầm', startSec: 0.2, endSec: 0.4 }];
    expect(validateNameCandidate('Rạch Mút.', aligned, { phrase: 'Rạch Gầm', kind: 'place' })).toMatchObject({
      accepted: false,
      reason: 'not found verbatim in narration',
    });
  });

  it('returns no validations for an empty candidate list', () => {
    expect(validateNameCandidates('Một câu không có tên.', words, [])).toEqual([]);
  });
});
