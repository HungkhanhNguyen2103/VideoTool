import { describe, expect, it } from 'vitest';
import { ProjectDocSchema, SceneDocSchema } from './docs';

const validLegacyDoc = {
  _id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  schemaVersion: 1 as const,
  title: 'Legacy project',
  titleSearch: 'legacy project',
  language: 'vi' as const,
  brief: 'A sufficiently long project brief.',
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
  status: 'draft' as const,
  scenes: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
};

describe('ProjectDocSchema visual style compatibility', () => {
  it('defaults legacy project documents to cinematic', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).visualStylePresetId).toBe('cinematic');
  });

  it('keeps keyword pop-ups enabled for legacy project documents', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).keywordPopupsEnabled).toBe(true);
  });

  it('keeps varied transitions enabled for legacy project documents', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).transitionStyle).toBe('varied');
  });

  it('defaults legacy project documents to automatic film look', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).filmLook).toBe('auto');
  });

  it('defaults legacy project documents to parallax off', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).parallax).toBe('off');
  });

  it('defaults legacy project documents to no draft render file', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).draftRenderFileId).toBeNull();
  });

  it('defaults legacy scene documents to no depth map', () => {
    expect(SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1 }).depthMap).toBeNull();
  });

  it('defaults legacy scene documents to an empty motion prompt', () => {
    expect(SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1 }).motionPrompt).toBe('');
  });
});
