import { describe, expect, it } from 'vitest';
import { ProjectDocSchema } from './docs';

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
});
