import { describe, expect, it } from 'vitest';
import { CreateProjectRequestSchema, ProjectDetailSchema } from '../../../contracts/project';
import { ChapterDocSchema, ChapterSnapshotSchema } from '../../../contracts/script';

const projectInput = {
  title: 'Script contract project',
  brief: 'A valid brief for script contract tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 2,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

describe('script contracts', () => {
  it('accepts chapters and snapshots with stable chapter metadata', () => {
    const chapter = ChapterDocSchema.parse({
      id: 'chapter-1',
      no: 1,
      title: 'Opening',
      paragraphs: ['First paragraph'],
      status: 'pending',
      scenesCount: null,
      durationSec: null,
    });
    const snapshot = ChapterSnapshotSchema.parse({ takenAt: new Date(), chapters: [chapter] });
    expect(snapshot.chapters[0]).toEqual(chapter);
  });

  it('defaults a new project to DeepSeek and exposes chapters in project detail', () => {
    const input = CreateProjectRequestSchema.parse(projectInput);
    expect(input.aiProvider).toBe('deepseek');

    const detail = ProjectDetailSchema.parse({
      id: 'project-1',
      ...projectInput,
      status: 'draft',
      scenes: [],
      chapters: [],
      aiProvider: input.aiProvider,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(detail.chapters).toEqual([]);
    expect(detail.aiProvider).toBe('deepseek');
  });
});
