import { describe, expect, it } from 'vitest';
import { ProjectDetailSchema } from '../../../contracts/project';
import { ChapterDocSchema } from '../../../contracts/script';
import { buildSceneSplitPrompt } from './ai/build-prompt';
import { parseSceneSplitBatch } from './ai/parse-output';

const project = ProjectDetailSchema.parse({
  id: 'project-1', title: 'River History', brief: 'Explain the history of the river.',
  status: 'script', language: 'en', referencesText: 'Archive notes', scriptPresetId: 'documentary',
  targetDurationSec: 120, chapterCount: 1, voiceId: null,
  renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
  scenes: [], chapters: [], version: 1, createdAt: '2026-09-23', updatedAt: '2026-09-23',
});
const chapter = ChapterDocSchema.parse({ id: 'chapter-1', no: 2, title: 'The Turning Point', paragraphs: ['Source'], status: 'approved', scenesCount: 1, durationSec: 12 });

describe('scene split AI contract', () => {
  it('parses positive indexed non-empty chunk sets', () => {
    expect(parseSceneSplitBatch('{"scenes":[{"sceneIndex":1,"chunks":["First beat","second beat"]}]}'))
      .toEqual({ scenes: [{ sceneIndex: 1, chunks: ['First beat', 'second beat'] }] });
  });

  it('rejects zero indexes and empty chunk sets as script parse errors', () => {
    expect(() => parseSceneSplitBatch('{"scenes":[{"sceneIndex":0,"chunks":[]}]}'))
      .toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
  });

  it('gives the model context, global indexes and exact narration without internal IDs', () => {
    const result = buildSceneSplitPrompt({
      project,
      chapter,
      scenes: [{ sceneId: 'internal-id', sceneIndex: 4, narration: 'Exact source text.' }],
    });
    expect(result.user).toContain('Scene 4\nNarration: Exact source text.');
    expect(result.user).toContain('Project title: River History');
    expect(result.user).toContain('Brief: Explain the history of the river.');
    expect(result.user).toContain('Language: English');
    expect(result.user).toContain('Chapter 2: The Turning Point');
    expect(result.user).not.toContain('internal-id');
    expect(result.system).toContain('exact contiguous substring');
    expect(result.system).toContain('Do not reword');
    expect(result.system).toContain('Echo each supplied sceneIndex exactly');
  });
});
