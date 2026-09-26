import { describe, expect, it } from 'vitest';
import { selectKeywords } from './keywords';

const words = (items: Array<[string, number, number]>) => items.map(([text, startSec, endSec]) => ({ text, startSec, endSec }));

describe('selectKeywords', () => {
  it('merges number units, strips punctuation, and finishes fading by the final word', () => {
    expect(selectKeywords(words([
      ['Doanh', 0, .3], ['thu', .3, .6], ['30', 1, 1.2], ['tỷ', 1.2, 1.5], ['đô', 1.5, 1.8], ['la,', 1.8, 2],
      ['tăng', 2.3, 2.6], ['mạnh.', 3, 3.3],
    ]))).toEqual([{ text: '30 tỷ đô la', startSec: 1, endSec: 2.5 }]);
  });

  it('excludes sentence-start capitals but selects a later proper-name run', () => {
    expect(selectKeywords(words([
      ['Eastman', 0, .3], ['Kodak', .3, .6], ['đã', .7, .9], ['gặp', 1, 1.2], ['Steven', 1.3, 1.6], ['Sasson.', 1.6, 1.9],
      ['ở', 3.7, 3.9], ['New', 4, 4.2], ['York', 4.2, 4.4], ['rất', 4.5, 4.7], ['lớn', 5, 5.2],
    ]))).toEqual([
      { text: 'Steven Sasson', startSec: 1.3, endSec: 2.8 },
      { text: 'New York', startSec: 4, endSec: 5.2 },
    ]);
  });

  it('does not treat names immediately after sentence punctuation as pop-ups', () => {
    expect(selectKeywords(words([
      ['Hết.', 0, .3], ['New', .5, .7], ['York', .7, .9], ['rồi', 1, 1.2], ['thôi', 2, 2.2],
    ]))).toEqual([]);
  });

  it('prefers numbers over names, limits to two, and enforces spacing', () => {
    expect(selectKeywords(words([
      ['hãng', 0, .2], ['Eastman', .4, .6], ['Kodak', .6, .8], ['có', 1, 1.1],
      ['30', 1.2, 1.4], ['tỷ', 1.4, 1.6], ['và', 2, 2.2], ['40', 3.8, 4], ['triệu', 4, 4.2],
      ['đến', 5, 5.2], ['Steven', 6, 6.2], ['Sasson', 6.2, 6.4], ['rồi', 7, 7.2], ['kết', 8, 8.2], ['thúc', 8.2, 8.4],
    ]))).toEqual([
      { text: '30 tỷ', startSec: 1.2, endSec: 2.7 },
      { text: '40 triệu', startSec: 3.8, endSec: 5.3 },
    ]);
  });

  it('skips overlapping or too-close candidates and returns none without timings', () => {
    expect(selectKeywords([])).toEqual([]);
    expect(selectKeywords(words([
      ['vào', 0, .2], ['1975.', .3, .5], ['có', 1, 1.2], ['2012', 1.4, 1.6], ['rồi', 3, 3.2], ['2020', 4.1, 4.3], ['kết', 6, 6.2],
    ]))).toEqual([
      { text: '1975', startSec: .3, endSec: 1.8 },
      { text: '2020', startSec: 4.1, endSec: 5.6 },
    ]);
  });

  it('clamps late phrases so their entire fade finishes before audio ends', () => {
    expect(selectKeywords(words([
      ['giá', 0, .2], ['30', 1, 1.2], ['tỷ', 1.2, 1.4], ['hết', 1.45, 1.7],
    ]))).toEqual([{ text: '30 tỷ', startSec: 1, endSec: 1.7 }]);
  });

  it('retains percent signs whether attached to a number or spoken as a separate token', () => {
    expect(selectKeywords(words([
      ['gần', 0, .2], ['90%,', .5, .8], ['và', 2, 2.2], ['85', 3.2, 3.4], ['%', 3.4, 3.6], ['hết', 5, 5.2],
    ]))).toEqual([
      { text: '90%', startSec: .5, endSec: 2 },
      { text: '85%', startSec: 3.2, endSec: 4.7 },
    ]);
  });

  it('turns a full Vietnamese date into one compact pop-up instead of a bare day', () => {
    expect(selectKeywords(words([
      ['Ngày', 0, .2], ['19', .2, .4], ['tháng', .4, .6], ['1', .6, .8], ['năm', .8, 1], ['2012,', 1, 1.3], ['sau', 2, 2.2], ['đó', 2.2, 2.4],
    ]))).toEqual([{ text: '19/1/2012', startSec: 0, endSec: 1.6 }]);
  });

  it('selects month-year and year-only date chains while retaining duration phrases', () => {
    expect(selectKeywords(words([
      ['tháng', 0, .2], ['1', .2, .4], ['năm', .4, .6], ['2012', .6, .9], ['và', 2, 2.2],
      ['năm', 3.5, 3.7], ['1975', 3.7, 4], ['rồi', 5, 5.2],
    ]))).toEqual([
      { text: '1/2012', startSec: 0, endSec: 1.5 },
      { text: '1975', startSec: 3.5, endSec: 5 },
    ]);
  });

  it('keeps a number followed by năm as a duration, not a date', () => {
    expect(selectKeywords(words([
      ['Nó', 0, .2], ['mất', .2, .4], ['37', 1, 1.2], ['năm.', 1.2, 1.4], ['xong', 2.5, 2.7],
    ]))).toEqual([{ text: '37 năm', startSec: 1, endSec: 2.5 }]);
  });
});
