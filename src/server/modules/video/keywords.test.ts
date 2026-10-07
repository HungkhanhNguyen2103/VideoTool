import { describe, expect, it } from 'vitest';
import { annotateNameKeywords, annotateYearKeywords, FILM_LOOK_BEFORE_YEAR, LOWER_THIRD_HOLD_SEC, parseNumberPhrase, resolveFilmLookByScene, selectKeywords, type Keyword } from './keywords';

const words = (items: Array<[string, number, number]>) => items.map(([text, startSec, endSec]) => ({ text, startSec, endSec }));

describe('selectKeywords', () => {
  it('merges number units, strips punctuation, and finishes fading by the final word', () => {
    expect(selectKeywords(words([
      ['Doanh', 0, .3], ['thu', .3, .6], ['30', 1, 1.2], ['tỷ', 1.2, 1.5], ['đô', 1.5, 1.8], ['la,', 1.8, 2],
      ['tăng', 2.3, 2.6], ['mạnh.', 3, 3.3],
    ]))).toMatchObject([{ text: '30 tỷ đô la', startSec: 1, endSec: 2.5 }]);
  });

  it('excludes sentence-start capitals and selects one later proper-name run', () => {
    expect(selectKeywords(words([
      ['Eastman', 0, .3], ['Kodak', .3, .6], ['đã', .7, .9], ['gặp', 1, 1.2], ['Steven', 1.3, 1.6], ['Sasson.', 1.6, 1.9],
      ['ở', 3.7, 3.9], ['New', 4, 4.2], ['York', 4.2, 4.4], ['rất', 4.5, 4.7], ['lớn', 5, 5.2],
    ]))).toMatchObject([
      { text: 'Steven Sasson', kind: 'name', nameRole: 'person', startSec: 1.3, endSec: 4.6 },
    ]);
  });

  it('does not treat names immediately after sentence punctuation as pop-ups', () => {
    expect(selectKeywords(words([
      ['Hết.', 0, .3], ['New', .5, .7], ['York', .7, .9], ['rồi', 1, 1.2], ['thôi', 2, 2.2],
    ]))).toMatchObject([]);
  });

  it('selects two centre pop-ups and one independent lower third', () => {
    expect(selectKeywords(words([
      ['hãng', 0, .2], ['Eastman', .4, .6], ['Kodak', .6, .8], ['có', 1, 1.1],
      ['30', 1.2, 1.4], ['tỷ', 1.4, 1.6], ['và', 2, 2.2], ['40', 3.8, 4], ['triệu', 4, 4.2],
      ['đến', 5, 5.2], ['Steven', 6, 6.2], ['Sasson', 6.2, 6.4], ['rồi', 7, 7.2], ['kết', 8, 8.2], ['thúc', 8.2, 8.4],
    ]))).toMatchObject([
      { text: 'Eastman Kodak', kind: 'name', nameRole: 'person', startSec: .4, endSec: 3.7 },
      { text: '30 tỷ', kind: 'number', startSec: 1.2, endSec: 2.7 },
      { text: '40 triệu', kind: 'number', startSec: 3.8, endSec: 5.3 },
    ]);
  });

  it('skips overlapping or too-close candidates and returns none without timings', () => {
    expect(selectKeywords([])).toEqual([]);
    expect(selectKeywords(words([
      ['vào', 0, .2], ['1975.', .3, .5], ['có', 1, 1.2], ['2012', 1.4, 1.6], ['rồi', 3, 3.2], ['2020', 4.1, 4.3], ['kết', 6, 6.2],
    ]))).toMatchObject([
      { text: '1975', startSec: .3, endSec: 1.8 },
      { text: '2020', startSec: 4.1, endSec: 5.6 },
    ]);
  });

  it('clamps late phrases so their entire fade finishes before audio ends', () => {
    expect(selectKeywords(words([
      ['giá', 0, .2], ['30', 1, 1.2], ['tỷ', 1.2, 1.4], ['hết', 1.45, 1.7],
    ]))).toMatchObject([{ text: '30 tỷ', startSec: 1, endSec: 1.7 }]);
  });

  it('retains percent signs whether attached to a number or spoken as a separate token', () => {
    expect(selectKeywords(words([
      ['gần', 0, .2], ['90%,', .5, .8], ['và', 2, 2.2], ['85', 3.2, 3.4], ['%', 3.4, 3.6], ['hết', 5, 5.2],
    ]))).toMatchObject([
      { text: '90%', startSec: .5, endSec: 2 },
      { text: '85%', startSec: 3.2, endSec: 4.7 },
    ]);
  });

  it('turns a full Vietnamese date into one compact pop-up instead of a bare day', () => {
    expect(selectKeywords(words([
      ['Ngày', 0, .2], ['19', .2, .4], ['tháng', .4, .6], ['1', .6, .8], ['năm', .8, 1], ['2012,', 1, 1.3], ['sau', 2, 2.2], ['đó', 2.2, 2.4],
    ]))).toMatchObject([{ text: '19/1/2012', startSec: 0, endSec: 1.6 }]);
  });

  it('selects month-year and year-only date chains while retaining duration phrases', () => {
    expect(selectKeywords(words([
      ['tháng', 0, .2], ['1', .2, .4], ['năm', .4, .6], ['2012', .6, .9], ['và', 2, 2.2],
      ['năm', 3.5, 3.7], ['1975', 3.7, 4], ['rồi', 5, 5.2],
    ]))).toMatchObject([
      { text: '1/2012', startSec: 0, endSec: 1.5 },
      { text: '1975', startSec: 3.5, endSec: 5 },
    ]);
  });

  it('keeps a number followed by năm as a duration, not a date', () => {
    expect(selectKeywords(words([
      ['Nó', 0, .2], ['mất', .2, .4], ['37', 1, 1.2], ['năm.', 1.2, 1.4], ['xong', 2.5, 2.7],
    ]))).toMatchObject([{ text: '37 năm', startSec: 1, endSec: 2.5 }]);
  });

  it('adds a role subtitle and detects places for names', () => {
    const result = selectKeywords(words([
      ['gặp', 0, .2], ['kỹ', .4, .6], ['sư', .6, .8], ['Steven', .8, 1], ['Sasson', 1, 1.2], ['sau', 3.8, 4],
    ]));
    expect(result).toMatchObject([{ text: 'Steven Sasson', kind: 'name', subtitle: 'Kỹ sư', nameRole: 'person' }]);
    expect(selectKeywords(words([
      ['ở', 0, .2], ['Rochester', .3, .5], ['nổi', 3, 3.2], ['tiếng', 3.2, 3.4],
    ]))).toMatchObject([{ text: 'Rochester', kind: 'name', nameRole: 'place' }]);
  });

  it('includes a lowercase geography prefix in the displayed place name and starts its timing at the prefix', () => {
    const result = selectKeywords(words([
      ['Trước', 0, .2], ['khi', .2, .4], ['trời', .4, .6], ['sáng,', .6, .8], ['trên', 1, 1.2], ['khúc', 1.2, 1.4],
      ['sông', 1.4, 1.6], ['Tiền,', 1.6, 1.8], ['khoảng', 2, 2.2], ['300', 2.2, 2.4], ['thuyền', 2.4, 2.6],
      ['Xiêm', 2.6, 2.8], ['đã', 3, 3.2], ['nằm', 3.2, 3.4], ['giữa', 3.4, 3.6], ['hai', 3.6, 3.8], ['làn', 3.8, 4], ['đạn.', 4, 4.2],
    ]));
    expect(result).toContainEqual(expect.objectContaining({ text: 'Sông Tiền', kind: 'name', nameRole: 'place', startSec: 1.4 }));
    expect(result.filter((keyword) => keyword.kind === 'name').map((keyword) => keyword.text)).not.toContain('Xiêm');
  });

  it('handles geography and event prefixes without moving role text into the popup', () => {
    expect(selectKeywords(words([
      ['ở', 0, .2], ['thành', .3, .5], ['phố', .5, .7], ['Mỹ', .7, .9], ['Tho,', .9, 1.1], ['rất', 3, 3.2], ['đông.', 4, 4.2],
    ]))).toContainEqual(expect.objectContaining({ text: 'Thành phố Mỹ Tho', nameRole: 'place', startSec: .3 }));
    const eventResult = selectKeywords(words([
      ['trong', 0, .2], ['trận', .3, .5], ['Rạch', .5, .7], ['Gầm,', .7, .9], ['quân', 3, 3.2], ['ta', 3.2, 3.4], ['thắng.', 4, 4.2],
    ]));
    expect(eventResult).toContainEqual(expect.objectContaining({ text: 'Trận Rạch Gầm', kind: 'name', startSec: .3 }));
    expect(eventResult.find((keyword) => keyword.text === 'Trận Rạch Gầm')).not.toHaveProperty('nameRole');
    expect(selectKeywords(words([
      ['ông', 0, .2], ['Nguyễn', .3, .5], ['Huệ,', .5, .7], ['sau', 3, 3.2], ['đó.', 4, 4.2],
    ]))).toContainEqual(expect.objectContaining({ text: 'Nguyễn Huệ', subtitle: 'Ông', nameRole: 'person' }));
    expect(selectKeywords(words([
      ['nhà', 0, .2], ['khoa', .2, .4], ['học', .4, .6], ['Trần', .7, .9], ['Văn', .9, 1.1], ['A,', 1.1, 1.3], ['đã', 3, 3.2], ['nói.', 4, 4.2],
    ]))).toContainEqual(expect.objectContaining({ text: 'Trần Văn A', subtitle: 'Nhà khoa học', nameRole: 'person' }));
  });

  it('allows only a prefixed proper name at sentence start', () => {
    expect(selectKeywords(words([
      ['Sông', 0, .2], ['Tiền', .2, .4], ['chảy', .5, .7], ['qua', .7, .9], ['đồng', 3, 3.2], ['bằng.', 4, 4.2],
    ]))).toContainEqual(expect.objectContaining({ text: 'Sông Tiền', nameRole: 'place', startSec: 0 }));
    expect(selectKeywords(words([
      ['Nguyễn', 0, .2], ['Huệ', .2, .4], ['tiến', .5, .7], ['quân', 3, 3.2], ['sang', 4, 4.2],
    ]))).not.toContainEqual(expect.objectContaining({ kind: 'name' }));
    expect(selectKeywords(words([
      ['trên', 0, .2], ['sông', .2, .4], ['lớn', .4, .6], ['chảy', 3, 3.2], ['mãi.', 4, 4.2],
    ])).filter((keyword) => keyword.kind === 'name')).toEqual([]);
  });

  it('uses the lower-third hold and skips names with too little remaining audio', () => {
    expect(LOWER_THIRD_HOLD_SEC).toBe(3);
    expect(selectKeywords(words([
      ['gặp', 0, .2], ['Steven', .4, .6], ['Sasson', .6, .8], ['xong', 3.2, 3.5],
    ]))).toMatchObject([{ text: 'Steven Sasson', endSec: 3.5 }]);
    expect(selectKeywords(words([
      ['gặp', 0, .2], ['Steven', .4, .6], ['Sasson', .6, .8], ['xong', 1.7, 1.8],
    ])).filter((keyword) => keyword.kind === 'name')).toEqual([]);
  });

  it('classifies kinds and attaches parsed number and year data', () => {
    const result = selectKeywords(words([
      ['Ngày', 0, .2], ['19', .2, .4], ['tháng', .4, .6], ['1', .6, .8], ['năm', .8, 1], ['2012,', 1, 1.3],
      ['hơn', 3, 3.2], ['30', 3.4, 3.6], ['tỷ', 3.6, 3.8], ['đô', 3.8, 4], ['la.', 4, 4.2], ['xong', 6, 6.2],
    ]));
    expect(result).toEqual([
      expect.objectContaining({ text: '19/1/2012', kind: 'date', year: 2012 }),
      expect.objectContaining({ text: '30 tỷ đô la', kind: 'number', value: 30, decimals: 0, grouping: false, prefix: '', suffix: 'tỷ đô la' }),
    ]);
    expect(selectKeywords(words([['vào', 0, .2], ['1975.', .3, .5], ['rồi', 2, 2.2]]))).toEqual([
      expect.objectContaining({ text: '1975', kind: 'year', year: 1975 }),
    ]);
    expect(selectKeywords(words([['năm', 0, .2], ['1975', .2, .5], ['rồi', 2, 2.2]]))[0]).toMatchObject({ kind: 'year', year: 1975 });
    expect(selectKeywords(words([['mất', 0, .2], ['37', .3, .5], ['năm', .5, .7], ['rồi', 2, 2.2]]))[0]).toMatchObject({ kind: 'number', value: 37, suffix: 'năm' });
    expect(selectKeywords(words([['và', 0, .2], ['Steven', .3, .5], ['Sasson', .5, .7], ['rồi', 2, 2.2]]))[0]).toMatchObject({ kind: 'name' });
  });
});
describe('parseNumberPhrase', () => {
  it('parses Vietnamese thousands and decimal separators', () => {
    expect(parseNumberPhrase('30')).toEqual({ value: 30, decimals: 0, grouping: false, prefix: '', suffix: '' });
    expect(parseNumberPhrase('90%')).toMatchObject({ value: 90, suffix: '%' });
    expect(parseNumberPhrase('1.000 người')).toMatchObject({ value: 1000, grouping: true, suffix: 'người' });
    expect(parseNumberPhrase('1,5 triệu')).toMatchObject({ value: 1.5, decimals: 1, suffix: 'triệu' });
  });

  it('returns null for malformed numbers so the plain pop-up is used', () => {
    expect(parseNumberPhrase('1.5.6')).toBeNull();
    expect(parseNumberPhrase('abc')).toBeNull();
    expect(parseNumberPhrase('12.34')).toBeNull();
  });
});

describe('annotateYearKeywords', () => {
  const kw = (text: string, startSec: number, kind: Keyword['kind'], year?: number): Keyword => ({ text, startSec, endSec: startSec + 1.5, kind, ...(year ? { year } : {}) });

  it('chains years across scenes in mention order and shares one padded timeline', () => {
    const result = annotateYearKeywords([
      [kw('1975', 1, 'year', 1975), kw('30 tỷ', 5, 'number')],
      [kw('19/1/2012', 0, 'date', 2012)],
      [kw('2020', 2, 'year', 2020)],
    ]);
    expect(result[0]![0]).toMatchObject({ fromYear: 1965, timeline: { min: 1962, max: 2023 } });
    expect(result[0]![1]).not.toHaveProperty('fromYear');
    expect(result[1]![0]).not.toHaveProperty('fromYear');
    expect(result[2]![0]).toMatchObject({ fromYear: 2012, timeline: { min: 1962, max: 2023 } });
  });

  it('handles a single year and leaves scenes without years untouched', () => {
    const single = annotateYearKeywords([[kw('1975', 0, 'year', 1975)]])[0]?.[0];
    expect(single).toMatchObject({ fromYear: 1965, timeline: { min: 1964, max: 1976 } });
    expect(annotateYearKeywords([[kw('30', 0, 'number')], []])).toEqual([[kw('30', 0, 'number')], []]);
  });
});

describe('annotateNameKeywords', () => {
  const kw = (text: string, startSec: number, kind: Keyword['kind']): Keyword => ({ text, startSec, endSec: startSec + 2, kind });

  it('keeps the first case- and diacritic-insensitive mention only', () => {
    const result = annotateNameKeywords([
      [kw('Steven Sasson', 1, 'name'), kw('30 tỷ', 2, 'number')],
      [kw('Stévên Sasson', 0, 'name'), kw('1975', 2, 'year')],
      [kw('Rochester', 0, 'name')],
    ]);
    expect(result).toEqual([
      [kw('Steven Sasson', 1, 'name'), kw('30 tỷ', 2, 'number')],
      [kw('1975', 2, 'year')],
      [kw('Rochester', 0, 'name')],
    ]);
  });

  it('deduplicates prefixed and bare mentions by their capitalized name run', () => {
    const result = annotateNameKeywords([
      [kw('Sông Tiền', 1, 'name')],
      [kw('Tiền', 2, 'name')],
      [kw('sông Tiền', 3, 'name')],
    ]);
    expect(result).toEqual([[kw('Sông Tiền', 1, 'name')], [], []]);
  });
});

describe('resolveFilmLookByScene', () => {
  const kw = (text: string, startSec: number, year?: number): Keyword => ({ text, startSec, endSec: startSec + .2, kind: year && text.includes('/') ? 'date' : 'year', ...(year === undefined ? {} : { year }) });

  it('turns on after a pre-1990 year and stays on until a later year turns it off', () => {
    expect(resolveFilmLookByScene([
      [],
      [kw('1975', 0, 1975)],
      [],
      [kw('19/1/2012', 0, 2012)],
      [],
    ])).toEqual([false, true, true, false, false]);
    expect(FILM_LOOK_BEFORE_YEAR).toBe(1990);
  });

  it('supports always and off modes', () => {
    const scenes = [[], [kw('1975', 0, 1975)]];
    expect(resolveFilmLookByScene(scenes, 'always')).toEqual([true, true]);
    expect(resolveFilmLookByScene(scenes, 'off')).toEqual([false, false]);
  });
});
