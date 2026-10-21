import { describe, expect, it } from 'vitest';
import { CreateProjectRequestSchema, ProjectDetailSchema, SceneSchema } from './project';
import { ProjectSummarySchema } from './project';

const validCreateInput = {
  title: 'Contract project',
  brief: 'A sufficiently long project brief.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

describe('visual style project field', () => {
  it('defaults create requests to cinematic, accepts flat-cartoon and strategic-map, and rejects unknown styles', () => {
    expect(CreateProjectRequestSchema.parse(validCreateInput).visualStylePresetId).toBe('cinematic');
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, visualStylePresetId: 'flat-cartoon' }).visualStylePresetId).toBe('flat-cartoon');
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, visualStylePresetId: 'strategic-map' as never }).visualStylePresetId).toBe('strategic-map');
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, visualStylePresetId: 'oil' })).toThrow();
  });

});

describe('script preset project field', () => {
  it('accepts strategist as a script preset', () => {
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, scriptPresetId: 'strategist' as never }).scriptPresetId).toBe('strategist');
  });
});

describe('voice speed project field', () => {
  it('defaults new project requests to normal narration speed and preserves valid steps', () => {
    expect(CreateProjectRequestSchema.parse(validCreateInput).voiceSpeed).toBe(1);
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, voiceSpeed: 1.2 }).voiceSpeed).toBe(1.2);
  });

  it('rejects speeds outside 0.8–1.3 or off the 0.05 step', () => {
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, voiceSpeed: 0.75 })).toThrow();
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, voiceSpeed: 1.31 })).toThrow();
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, voiceSpeed: 1.11 })).toThrow();
  });
});

describe('project channel field', () => {
  it('defaults new, legacy detail, and legacy summary payloads to no channel', () => {
    expect(CreateProjectRequestSchema.parse(validCreateInput).channelId).toBeNull();
    const legacyDetail = {
      id: 'project-1', title: 'Project', status: 'draft', language: 'vi', brief: '', referencesText: '',
      scriptPresetId: 'documentary', targetDurationSec: 60, chapterCount: null, voiceId: null,
      renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, scenes: [], version: 1,
      createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    };
    expect(ProjectDetailSchema.parse(legacyDetail).channelId).toBeNull();
    expect(ProjectDetailSchema.parse(legacyDetail).youtubeVideoId).toBeNull();
    expect(ProjectDetailSchema.parse({ ...legacyDetail, youtubeVideoId: 'video-1' }).youtubeVideoId).toBe('video-1');
    expect(ProjectSummarySchema.parse({ id: 'project-1', title: 'Project', status: 'draft', scenesCount: null, durationSec: null, updatedAt: '2026-10-21T00:00:00.000Z' }).channelId).toBeNull();
    expect(CreateProjectRequestSchema.parse({ ...validCreateInput, channelId: 'channel-1' }).channelId).toBe('channel-1');
    expect(() => CreateProjectRequestSchema.parse({ ...validCreateInput, channelId: '' })).toThrow();
  });
});

describe('scene active field', () => {
  const legacyScene = { id: 'scene-1', narration: 'Narration', visualPrompt: '', durationSec: 1 };

  it('defaults legacy scenes to active and preserves an explicit inactive flag', () => {
    expect(SceneSchema.parse(legacyScene).active).toBe(true);
    expect(SceneSchema.parse({ ...legacyScene, active: false }).active).toBe(false);
  });
});

describe('scene shot and light plan fields', () => {
  const scene = { id: 'scene-1', narration: 'Narration', visualPrompt: '', durationSec: 1 };

  it('defaults legacy scenes to null and accepts valid assignments', () => {
    expect(SceneSchema.parse(scene)).toMatchObject({ shotType: null, lightType: null });
    expect(SceneSchema.parse({ ...scene, shotType: 'high-angle', lightType: 'golden-hour' })).toMatchObject({ shotType: 'high-angle', lightType: 'golden-hour' });
  });

  it('rejects unknown shot and light values', () => {
    expect(SceneSchema.safeParse({ ...scene, shotType: 'aerial' }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...scene, lightType: 'neon' }).success).toBe(false);
  });
});

describe('render snapshot contract', () => {
  const projectDetail = {
    id: 'project-1',
    title: 'Project',
    status: 'rendered',
    language: 'vi',
    brief: '',
    referencesText: '',
    scriptPresetId: 'documentary',
    targetDurationSec: 60,
    chapterCount: null,
    voiceId: null,
    renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
    scenes: [],
    version: 1,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  };

  it('accepts the rendered active-scene snapshot and leaves it absent for legacy projects', () => {
    expect(ProjectDetailSchema.parse({ ...projectDetail, renderedActiveSceneIds: ['scene-1', 'scene-3'] }).renderedActiveSceneIds).toEqual(['scene-1', 'scene-3']);
    expect(ProjectDetailSchema.parse(projectDetail).renderedActiveSceneIds).toBeUndefined();
  });
});
