import { describe, expect, it } from 'vitest';
import { parsePopupAiOutput } from './parse-output';

describe('popup AI output parser', () => {
  it('parses JSON in a markdown code fence', () => {
    expect(parsePopupAiOutput('```json\n{"scenes":[]}\n```')).toEqual({ scenes: [] });
  });

  it('rejects malformed JSON instead of silently selecting rules', () => {
    expect(() => parsePopupAiOutput('{not-json}')).toThrow(/JSON/iu);
  });
});
