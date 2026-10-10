import { describe, expect, it } from 'vitest';
import { buildScriptGenerationRequest, cliGenerationEstimate } from './generation-mode';

describe('script generation backend request', () => {
  it('keeps API as an explicit default and includes no project AI settings', () => {
    expect(buildScriptGenerationRequest({ backend: 'api', resume: false })).toEqual({ backend: 'api' });
  });

  it('sends a CLI default model as null and preserves resume without project provider fields', () => {
    expect(buildScriptGenerationRequest({ backend: 'cli', cliModel: null, resume: true })).toEqual({
      backend: 'cli', cliModel: null, resume: true,
    });
  });

  it('sends only the selected local CLI model when one is chosen', () => {
    expect(buildScriptGenerationRequest({ backend: 'cli', cliModel: 'claude-sonnet-5-5', resume: false })).toEqual({
      backend: 'cli', cliModel: 'claude-sonnet-5-5',
    });
  });
});

describe('CLI script-generation estimate', () => {
  it('uses measured Task 94 outline, repair, and chapter call timings', () => {
    expect(cliGenerationEstimate(7)).toMatchObject({ minMinutes: 16, maxMinutes: 28, chapterCount: 7 });
    expect(cliGenerationEstimate(2, false)).toMatchObject({ minMinutes: 4, maxMinutes: 7, chapterCount: 2 });
    expect(cliGenerationEstimate(7).label).toContain('16–28 phút');
  });
});
