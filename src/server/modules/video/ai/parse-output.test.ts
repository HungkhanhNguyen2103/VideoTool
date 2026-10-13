import { describe, expect, it } from 'vitest';
import { parsePopupAiOutput, parsePopupAiOutputForScenes } from './parse-output';

describe('popup AI output parser', () => {
  it('parses JSON in a markdown code fence', () => {
    expect(parsePopupAiOutput('```json\n{"scenes":[]}\n```')).toEqual({ scenes: [] });
  });

  it('rejects malformed JSON instead of silently selecting rules', () => {
    expect(() => parsePopupAiOutput('{not-json}')).toThrow(/JSON/iu);
  });

  it('requires one unique verdict for every requested primary scene', () => {
    const valid = '{"scenes":[{"scene":1,"needed":false,"reason":"Không cần.","popups":[]},{"scene":2,"needed":false,"reason":"Không cần.","popups":[]}]}';
    expect(parsePopupAiOutputForScenes(valid, [1, 2])).toEqual(expect.objectContaining({ scenes: expect.any(Array) }));
    expect(() => parsePopupAiOutputForScenes(valid.replace('"scene":2', '"scene":1'), [1, 2])).toThrow(/scene/i);
    expect(() => parsePopupAiOutputForScenes('{"scenes":[{"scene":1,"needed":false,"reason":"Không cần.","popups":[]}]}', [1, 2])).toThrow(/scene/i);
  });
});
