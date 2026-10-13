import { describe, expect, it } from 'vitest';
import { ProjectDocSchema, SceneDocSchema } from './docs';
import { SfxVolumeSchema } from '../../../contracts/project';

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

  it('defaults legacy projects to low popup density', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).popupDensity).toBe('low');
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

  it('defaults legacy project documents to a 0.2 second scene tail', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).sceneTailSec).toBe(0.2);
  });

  it('defaults legacy project documents to half voiceover-relative SFX volume', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).sfxVolume).toBe(0.5);
  });

  it('defaults legacy project documents to normal voice speed', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).voiceSpeed).toBe(1);
  });

  it('accepts hundredth-precision SFX volume values including the Studio 0.05 steps', () => {
    for (const value of [0.1, 0.15, 0.2, 0.35, 0.55, 0.95, 1]) expect(SfxVolumeSchema.parse(value)).toBe(value);
  });

  it('defaults legacy project documents to no draft render file', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).draftRenderFileId).toBeNull();
    expect(ProjectDocSchema.parse(validLegacyDoc).logoFileId).toBeNull();
  });

  it('defaults legacy project documents to an empty SEO package', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).seo).toEqual({
      titles: [],
      chosenTitleId: null,
      descriptionIntro: '',
      tags: [],
      hashtags: [],
      pinnedComment: '',
      thumbnail: { ideas: [], chosenIdeaId: null, fileId: null },
      generatedBy: null,
    });
  });

  it('defaults legacy scene documents to no depth map', () => {
    expect(SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1 }).depthMap).toBeNull();
  });

  it('defaults legacy scene documents to an empty motion prompt', () => {
    expect(SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1 }).motionPrompt).toBe('');
  });

  it('defaults legacy scene documents to no analyzed name candidates', () => {
    expect(SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1 }).nameCandidates).toBeNull();
  });

  it('defaults legacy scene documents to no popup plan', () => {
    expect(SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1 }).popupPlan).toBeNull();
  });

  it('stores the ordered active scene ids used for a final render and keeps legacy documents without a snapshot', () => {
    expect(ProjectDocSchema.parse(validLegacyDoc).renderedActiveSceneIds).toBeUndefined();
    expect(ProjectDocSchema.parse({ ...validLegacyDoc, renderedActiveSceneIds: ['scene-1', 'scene-3'] }).renderedActiveSceneIds).toEqual(['scene-1', 'scene-3']);
  });

  it('defaults legacy scene documents to active and preserves active:false in project documents', () => {
    const legacyScene = SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1 });
    expect(legacyScene.active).toBe(true);

    const inactiveProject = ProjectDocSchema.parse({ ...validLegacyDoc, scenes: [{ ...legacyScene, active: false }] });
    expect(inactiveProject.scenes[0]?.active).toBe(false);
  });

  it('defaults legacy scene documents to no voiceover input record', () => {
    expect(SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1 }).voiceoverInput).toBeNull();
  });

  it('accepts fractional scene durations and defaults legacy voiceover measurements to null', () => {
    expect(SceneDocSchema.parse({ id: 'scene-1', narration: '', visualPrompt: '', durationSec: 1.25 })).toMatchObject({
      durationSec: 1.25,
      voiceoverDurationSec: null,
    });
  });
});
