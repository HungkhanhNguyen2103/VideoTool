import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Collection } from 'mongodb';
import { CreateProjectRequestSchema, ProjectDetailSchema } from '../../../contracts/project';
import { ChapterDocSchema, ChapterSnapshotSchema } from '../../../contracts/script';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';
import { getAiClient } from '../../shared/ai';
import { applyEmptySceneVisualPrompts, applyEmptySceneVisualPromptsWithResult, createProject, getProject, getProjectHistory, patchProjectScene, replaceProjectChapters, replaceProjectScenes, replaceProjectScript, setProjectAiProvider } from '../project';
import { buildRegenerationPromptForChapter, finalizeScript, generateScript, patchChapter, regenerateChapter, restoreChapters, saveGeneratedScript } from './service';
import { runFinalQa } from './qa';

const aiMock = vi.hoisted(() => ({ model: 'deepseek-chat', chat: vi.fn(), stream: vi.fn() }));
vi.mock('../../shared/ai', () => ({ getAiClient: vi.fn(() => aiMock) }));
type JobRecord = { _id: string; type: string; payload: unknown };

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

const regeneratedResponse = (paragraphs: string[] = ['New paragraph'], continuity = { chapterSummary: 'New summary', avoidRepeating: ['New avoidance'], persistentFactsNext: ['New fact'] }) => JSON.stringify({ paragraphs, ...continuity });

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  await getCollection('jobs').deleteMany({});
  aiMock.chat.mockReset();
  aiMock.stream.mockReset();
  vi.mocked(getAiClient).mockClear();
});
afterAll(() => closeTestMongo());
let server: Server | null = null;
afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
});

async function startScriptServer(): Promise<string> {
  const app = createApp({ filesDir: './data/files', clientDir: null });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function projectWithFinalizedScenes() {
  const project = await createProject(projectInput);
  await replaceProjectScenes(project.id, [
    { id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 10, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
    { id: 'scene-2', narration: 'Two', visualPrompt: '', durationSec: 10, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
    { id: 'scene-3', narration: 'Three', visualPrompt: 'Manual prompt', durationSec: 10, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
  ], 'assets');
  return getProject(project.id);
}

describe('empty scene visual prompts', () => {
  it('returns exact changed IDs from the atomic pre-image while preserving the wrapper contract', async () => {
    const project = await projectWithFinalizedScenes();
    const result = await applyEmptySceneVisualPromptsWithResult(project.id, [
      { sceneId: 'scene-1', visualPrompt: 'Generated 1' },
      { sceneId: 'scene-2', visualPrompt: 'Generated 2' },
      { sceneId: 'scene-3', visualPrompt: 'Must stay manual' },
      { sceneId: 'scene-1', visualPrompt: 'Final 1' },
    ]);
    expect(result.updatedSceneIds).toEqual(['scene-1', 'scene-2']);
    expect(result.project.version).toBe(project.version + 1);
    expect(result.project.scenes.map((scene) => scene.visualPrompt)).toEqual(['Final 1', 'Generated 2', 'Manual prompt']);
    const noOp = await applyEmptySceneVisualPromptsWithResult(project.id, [{ sceneId: 'scene-1', visualPrompt: 'Another' }]);
    expect(noOp.updatedSceneIds).toEqual([]);
    expect(noOp.project.version).toBe(result.project.version);
  });

  it('fills SFX independently when the visual prompt is already filled', async () => {
    const project = await projectWithFinalizedScenes();
    const result = await applyEmptySceneVisualPromptsWithResult(project.id, [{
      sceneId: 'scene-3', visualPrompt: 'Should stay manual', sfxPrompt: 'Footsteps in the hall',
    }]);
    expect(result.updatedSceneIds).toEqual([]);
    expect(result.updatedSfxPromptSceneIds).toEqual(['scene-3']);
    expect(result.project.scenes[2]).toMatchObject({ visualPrompt: 'Manual prompt', sfxPrompt: 'Footsteps in the hall' });
    expect(result.project.version).toBe(project.version + 1);
  });

  it('fills the visual prompt independently when SFX is already filled', async () => {
    const project = await projectWithFinalizedScenes();
    await patchProjectScene(project.id, 'scene-1', { sfxPrompt: 'Manual river water' });
    const before = await getProject(project.id);
    const result = await applyEmptySceneVisualPromptsWithResult(project.id, [{
      sceneId: 'scene-1', visualPrompt: 'Bridge at dawn', sfxPrompt: 'Should stay manual',
    }]);
    expect(result.updatedSceneIds).toEqual(['scene-1']);
    expect(result.updatedSfxPromptSceneIds).toEqual([]);
    expect(result.project.scenes[0]).toMatchObject({ visualPrompt: 'Bridge at dawn', sfxPrompt: 'Manual river water' });
    expect(result.project.version).toBe(before.version + 1);
  });

  it('returns only the scene still empty at the atomic write when a manual edit races with it', async () => {
    const project = await projectWithFinalizedScenes();
    const original = Collection.prototype.findOneAndUpdate;
    const spy = vi.spyOn(Collection.prototype, 'findOneAndUpdate').mockImplementationOnce(async function (this: Collection, ...args) {
      await patchProjectScene(project.id, 'scene-1', { visualPrompt: 'Generated 1' });
      return original.apply(this, args);
    });
    try {
      const result = await applyEmptySceneVisualPromptsWithResult(project.id, [
        { sceneId: 'scene-1', visualPrompt: 'Generated 1' },
        { sceneId: 'scene-2', visualPrompt: 'Generated 2' },
      ]);
      expect(result.updatedSceneIds).toEqual(['scene-2']);
      expect(result.project.scenes.map((scene) => scene.visualPrompt)).toEqual(['Generated 1', 'Generated 2', 'Manual prompt']);
      expect(result.project.version).toBe(project.version + 2);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns no changed IDs and no extra version bump when the atomic predicate no longer matches', async () => {
    const project = await projectWithFinalizedScenes();
    const original = Collection.prototype.findOneAndUpdate;
    const spy = vi.spyOn(Collection.prototype, 'findOneAndUpdate').mockImplementationOnce(async function (this: Collection, ...args) {
      await patchProjectScene(project.id, 'scene-1', { visualPrompt: 'Manual 1' });
      await patchProjectScene(project.id, 'scene-2', { visualPrompt: 'Manual 2' });
      return original.apply(this, args);
    });
    try {
      const result = await applyEmptySceneVisualPromptsWithResult(project.id, [
        { sceneId: 'scene-1', visualPrompt: 'Generated 1' },
        { sceneId: 'scene-2', visualPrompt: 'Generated 2' },
      ]);
      expect(result.updatedSceneIds).toEqual([]);
      expect(result.project.version).toBe(project.version + 2);
      expect(result.project.scenes.map((scene) => scene.visualPrompt)).toEqual(['Manual 1', 'Manual 2', 'Manual prompt']);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns only the SFX target still empty when a manual SFX edit races with it', async () => {
    const project = await projectWithFinalizedScenes();
    const original = Collection.prototype.findOneAndUpdate;
    const spy = vi.spyOn(Collection.prototype, 'findOneAndUpdate').mockImplementationOnce(async function (this: Collection, ...args) {
      await patchProjectScene(project.id, 'scene-1', { sfxPrompt: 'Manual wind' });
      return original.apply(this, args);
    });
    try {
      const result = await applyEmptySceneVisualPromptsWithResult(project.id, [
        { sceneId: 'scene-1', sfxPrompt: 'Generated wind' },
        { sceneId: 'scene-2', sfxPrompt: 'Generated water' },
      ]);
      expect(result.updatedSceneIds).toEqual([]);
      expect(result.updatedSfxPromptSceneIds).toEqual(['scene-2']);
      expect(result.project.scenes.map((scene) => scene.sfxPrompt)).toEqual(['Manual wind', 'Generated water', '']);
      expect(result.project.version).toBe(project.version + 2);
    } finally {
      spy.mockRestore();
    }
  });

  it('applies two targets in one version increment and keeps the last duplicate value', async () => {
    const project = await projectWithFinalizedScenes();
    const updated = await applyEmptySceneVisualPrompts(project.id, [
      { sceneId: 'scene-1', visualPrompt: 'First value' },
      { sceneId: 'scene-2', visualPrompt: 'Second value' },
      { sceneId: 'scene-1', visualPrompt: 'Last value' },
    ]);
    expect(updated.version).toBe(project.version + 1);
    expect(updated.scenes.map((scene) => scene.visualPrompt)).toEqual(['Last value', 'Second value', 'Manual prompt']);
  });

  it('keeps the last duplicate value independently for visual and SFX prompts', async () => {
    const project = await projectWithFinalizedScenes();
    const updated = await applyEmptySceneVisualPrompts(project.id, [
      { sceneId: 'scene-1', visualPrompt: 'First visual', sfxPrompt: 'First SFX' },
      { sceneId: 'scene-1', visualPrompt: 'Last visual' },
      { sceneId: 'scene-1', sfxPrompt: 'Last SFX' },
    ]);
    expect(updated.version).toBe(project.version + 1);
    expect(updated.scenes[0]).toMatchObject({ visualPrompt: 'Last visual', sfxPrompt: 'Last SFX' });
  });

  it('rejects a missing scene before changing any valid scene', async () => {
    const project = await projectWithFinalizedScenes();
    await expect(applyEmptySceneVisualPrompts(project.id, [
      { sceneId: 'scene-1', visualPrompt: 'Generated' },
      { sceneId: 'missing', visualPrompt: 'Invalid' },
    ])).rejects.toMatchObject({ code: 'not_found' });
    expect(await getProject(project.id)).toEqual(project);
  });

  it('preserves a non-empty manual prompt while updating an empty target', async () => {
    const project = await projectWithFinalizedScenes();
    const updated = await applyEmptySceneVisualPrompts(project.id, [
      { sceneId: 'scene-1', visualPrompt: 'Generated' },
      { sceneId: 'scene-3', visualPrompt: 'Overwrite attempt' },
    ]);
    expect(updated.scenes.map((scene) => scene.visualPrompt)).toEqual(['Generated', '', 'Manual prompt']);
    expect(updated.version).toBe(project.version + 1);
  });

  it('does not change the project or version when every target is non-empty', async () => {
    const project = await projectWithFinalizedScenes();
    const updated = await applyEmptySceneVisualPrompts(project.id, [{ sceneId: 'scene-3', visualPrompt: 'Overwrite attempt' }]);
    expect(updated).toEqual(project);
    expect(await getProject(project.id)).toEqual(project);
  });

  it('returns the current project unchanged for an empty update list', async () => {
    const project = await projectWithFinalizedScenes();
    expect(await applyEmptySceneVisualPrompts(project.id, [])).toEqual(project);
  });
});

describe('script contracts', () => {
  it('owns the provider patch route and does not enqueue a job', async () => {
    const project = await createProject(projectInput);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/ai-provider`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'claude' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).aiProvider).toBe('claude');
    expect(await getCollection('jobs').countDocuments({})).toBe(0);
  });

  it('stores a valid model, resets it on provider change, and rejects a model for the wrong provider', async () => {
    const baseUrl = await startScriptServer();
    const createdResponse = await fetch(`${baseUrl}/api/project`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...projectInput, aiProvider: 'deepseek', aiModel: 'deepseek-flash' }),
    });
    const created = await createdResponse.json();
    expect(createdResponse.status).toBe(201);
    expect(created.aiModel).toBe('deepseek-flash');

    const modelResponse = await fetch(`${baseUrl}/api/project/${created.id}/ai-provider`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', aiModel: 'deepseek-v4-pro' }),
    });
    expect(modelResponse.status).toBe(200);
    expect(await modelResponse.json()).toMatchObject({ aiProvider: 'deepseek', aiModel: 'deepseek-v4-pro' });

    const providerResponse = await fetch(`${baseUrl}/api/project/${created.id}/ai-provider`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'claude' }),
    });
    const changed = await providerResponse.json();
    expect(providerResponse.status).toBe(200);
    expect(changed).toMatchObject({ aiProvider: 'claude', aiModel: 'claude-opus-4-5' });

    const invalidResponse = await fetch(`${baseUrl}/api/project/${created.id}/ai-provider`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', aiModel: 'deepseek-flash' }),
    });
    const invalid = await invalidResponse.json();
    expect(invalidResponse.status).toBe(422);
    expect(invalid.error.message).toContain('deepseek-flash');
    expect((await getProject(created.id)).aiModel).toBe('claude-opus-4-5');
  });

  it('rejects an unknown model on project creation with an actionable 422 error', async () => {
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...projectInput, aiProvider: 'deepseek', aiModel: 'deepseek-retired' }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: 'AI_MODEL_UNAVAILABLE' });
    expect(body.error.message).toContain('deepseek-retired');
    expect(body.error.message).toContain('hãy chọn model khác');
    expect(await getCollection('projects').countDocuments({})).toBe(0);
  });

  it('rejects an invalid provider before any project mutation', async () => {
    const project = await createProject(projectInput);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/ai-provider`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'other' }),
    });
    expect(response.status).toBe(400);
    expect((await getProject(project.id)).aiProvider).toBe('deepseek');
    expect(await getCollection('jobs').countDocuments({})).toBe(0);
  });

  it('owns the visual style patch route and does not enqueue a job', async () => {
    const project = await createProject(projectInput);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/visual-style`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visualStylePresetId: 'watercolor' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).visualStylePresetId).toBe('watercolor');
    expect(await getCollection('jobs').countDocuments({})).toBe(0);
  });

  it('rejects an invalid visual style before any project mutation', async () => {
    const project = await createProject(projectInput);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/visual-style`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visualStylePresetId: 'other' }),
    });
    expect(response.status).toBe(400);
    expect((await getProject(project.id)).visualStylePresetId).toBe('cinematic');
    expect(await getCollection('jobs').countDocuments({})).toBe(0);
  });

  it('returns a flattened manual prompt without enqueuing a job', async () => {
    const project = await createProject(projectInput);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/generate-script/manual-prompt`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ prompt: expect.any(String), promptVersion: 'script-prompt-v3/documentary@3' });
    expect(body.prompt).toContain('SYSTEM');
    expect(body.prompt).toContain('USER');
    expect(await getCollection('jobs').countDocuments({})).toBe(0);
  });

  it('returns the same chapter regeneration prompt as the automatic path without changing state', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [
      { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old opening'], status: 'pending', scenesCount: null, durationSec: null },
      { id: 'chapter-2', no: 2, title: 'Close', paragraphs: ['Old close'], status: 'approved', scenesCount: null, durationSec: null },
    ], null, 'script');
    const current = await replaceProjectScript(project.id, (await getProject(project.id)).chapters, [{ question: 'What changed?', plantedInChapter: 1, resolvedInChapter: 2 }], null, 'Why did it happen?', 'It began at dawn.', null, 'script');
    const expected = buildRegenerationPromptForChapter(current, 'chapter-1', { instruction: 'Make the hook sharper', level: 'light' });
    const baseUrl = await startScriptServer();

    const response = await fetch(`${baseUrl}/api/project/${project.id}/chapters/chapter-1/regenerate/manual-prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'Make the hook sharper', level: 'light' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ prompt: `SYSTEM\n${expected.prompt.system}\n\nUSER\n${expected.prompt.user}`, promptVersion: expected.prompt.promptVersion });
    expect(await getProject(project.id)).toEqual(current);
    expect(aiMock.chat).not.toHaveBeenCalled();
    expect(aiMock.stream).not.toHaveBeenCalled();
  });

  it('imports a regenerated chapter through the shared parser and marks only the next chapter upstream-changed', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [
      { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old opening'], status: 'approved', scenesCount: null, durationSec: null },
      { id: 'chapter-2', no: 2, title: 'Middle', paragraphs: ['Old middle'], status: 'approved', scenesCount: null, durationSec: null, reviewStatus: 'clean' },
      { id: 'chapter-3', no: 3, title: 'Close', paragraphs: ['Old close'], status: 'pending', scenesCount: null, durationSec: null, reviewStatus: 'clean' },
    ], null, 'script');
    const before = await getProject(project.id);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/chapters/chapter-2/regenerate/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: regeneratedResponse(['Manual middle']) }),
    });
    const body = await response.json();
    const saved = await getProject(project.id);
    const history = await getProjectHistory(project.id);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: 'chapter-2', paragraphs: ['Manual middle'], status: 'pending', chapterSummary: 'New summary', avoidRepeating: ['New avoidance'], persistentFacts: ['New fact'], reviewStatus: 'clean' });
    expect(saved.chapters[1]).toMatchObject({ paragraphs: ['Manual middle'], status: 'pending', reviewStatus: 'clean' });
    expect(saved.chapters[2]).toMatchObject({ reviewStatus: 'upstream-changed' });
    expect(saved.chapters[0]).toMatchObject({ status: 'approved', reviewStatus: 'clean' });
    expect(history).toHaveLength(1);
    expect(history[0]!.chapters).toEqual(before.chapters);

    const restored = await restoreChapters(project.id, 0);
    expect(restored.find((chapter) => chapter.id === 'chapter-2')?.paragraphs).toEqual(['Old middle']);
  });

  it('rejects invalid regenerated JSON without changing the chapter', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');
    const before = await getProject(project.id);
    const historyBefore = await getProjectHistory(project.id);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/chapters/chapter-1/regenerate/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: '{bad json' }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('SCRIPT_PARSE_ERROR');
    expect(body.error.message).toBe('JSON của chương không hợp lệ. Hãy dán nguyên văn JSON do AI trả về, không kèm chữ giải thích bên ngoài; kiểm tra dấu ngoặc và dấu phẩy.');
    expect(body.error.message).not.toContain('AI returned');
    expect(await getProject(project.id)).toEqual(before);
    expect(await getProjectHistory(project.id)).toEqual(historyBefore);
  });

  it('translates a manual chapter schema error while preserving the field path and state', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');
    const before = await getProject(project.id);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/chapters/chapter-1/regenerate/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify({ paragraphs: 'not an array', chapterSummary: 'Summary', avoidRepeating: [], persistentFactsNext: [] }) }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: 'SCRIPT_PARSE_ERROR', message: expect.stringContaining('JSON của chương thiếu hoặc sai trường: paragraphs:') });
    expect(body.error.message).not.toContain('AI returned');
    expect(await getProject(project.id)).toEqual(before);
  });

  it('keeps only the ten newest manual-import chapter snapshots', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Original'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');
    const baseUrl = await startScriptServer();

    for (let index = 0; index < 12; index += 1) {
      const response = await fetch(`${baseUrl}/api/project/${project.id}/chapters/chapter-1/regenerate/manual-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: regeneratedResponse([`Manual ${index}`]) }),
      });
      expect(response.status).toBe(200);
    }

    const history = await getProjectHistory(project.id);
    expect(history).toHaveLength(10);
    expect(history[0]!.chapters.find((chapter) => chapter.id === 'chapter-1')?.paragraphs).toEqual(['Manual 10']);
  });

  it('returns 404 for a manual regeneration prompt for an unknown chapter', async () => {
    const project = await createProject(projectInput);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/chapters/missing/regenerate/manual-prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: '', level: 'medium' }),
    });

    expect(response.status).toBe(404);
  });

  it('imports a manual document through the shared save path without calling the AI client', async () => {
    const project = await createProject(projectInput);
    const raw = JSON.stringify({
      chapters: [
        { no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 4, endsOnTension: true, paragraphs: ['Manual paragraph'] },
        { no: 2, title: 'Close', role: 'resolution', beat: 'Close', targetWords: 4, endsOnTension: false, paragraphs: ['Manual conclusion'] },
      ],
      openLoops: [],
      coreQuestion: 'What is at stake?',
      openingHook: 'A compelling opening.',
    });
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/generate-script/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.chapters[0]).toMatchObject({ title: 'Opening', paragraphs: ['Manual paragraph'], status: 'pending' });
    expect(aiMock.chat).not.toHaveBeenCalled();
    expect(await getCollection('jobs').countDocuments({})).toBe(0);
  });

  it('rejects a manual document missing outline continuity fields before any write', async () => {
    const project = await createProject(projectInput);
    const raw = JSON.stringify({
      chapters: [{ no: 1, title: 'Only chapter', role: 'hook', beat: 'Open', targetWords: 4, endsOnTension: false, paragraphs: ['Manual paragraph'] }],
      openLoops: [],
    });
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/generate-script/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('SCRIPT_PARSE_ERROR');
    expect(await getProject(project.id)).toEqual(project);
  });

  it('rejects a manual chapter-count mismatch without changing the project', async () => {
    const project = await createProject(projectInput);
    const raw = JSON.stringify({
      chapters: [{ no: 1, title: 'Only chapter', role: 'hook', beat: 'Open', targetWords: 4, endsOnTension: false, paragraphs: ['Manual paragraph'] }],
      openLoops: [],
      coreQuestion: 'What is at stake?',
      openingHook: 'A compelling opening.',
    });
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/generate-script/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
    });
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error.code).toBe('SCRIPT_PARSE_ERROR');
    expect(body.error.message).toBe('Số chương trong bản thảo không khớp với số chương đã chọn cho dự án.');
    expect(await getProject(project.id)).toEqual(project);
  });

  it('rejects malformed manual text without changing the project', async () => {
    const project = await createProject(projectInput);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/generate-script/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: '{bad json' }),
    });
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error.code).toBe('SCRIPT_PARSE_ERROR');
    expect(body.error.message).toBe('JSON của bản thảo kịch bản không hợp lệ. Hãy dán nguyên văn JSON do AI trả về, không kèm chữ giải thích bên ngoài; kiểm tra dấu ngoặc và dấu phẩy.');
    expect(body.error.message).not.toContain('AI returned');
    expect(await getProject(project.id)).toEqual(project);
    expect(await getCollection('jobs').countDocuments({})).toBe(0);
  });

  it('translates a manual script schema error while preserving the field path and state', async () => {
    const project = await createProject(projectInput);
    const before = await getProject(project.id);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/generate-script/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify({ chapters: 'not an array' }) }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: 'SCRIPT_PARSE_ERROR', message: expect.stringContaining('JSON của bản thảo kịch bản thiếu hoặc sai trường: chapters:') });
    expect(body.error.message).not.toContain('AI returned');
    expect(await getProject(project.id)).toEqual(before);
  });

  it('keeps trailing text after a fenced manual JSON block invalid', async () => {
    const project = await createProject(projectInput);
    const baseUrl = await startScriptServer();
    const response = await fetch(`${baseUrl}/api/project/${project.id}/generate-script/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: '```json\n{"chapters":[]}\n``` trailing text' }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: 'SCRIPT_PARSE_ERROR', message: expect.stringContaining('JSON của bản thảo kịch bản không hợp lệ.') });
  });

  it('changes the AI provider through one project-owned versioned mutation', async () => {
    const project = await createProject(projectInput);
    const updated = await setProjectAiProvider(project.id, 'claude');
    expect(updated.aiProvider).toBe('claude');
    expect(updated.version).toBe(project.version + 1);
    expect((await getProject(project.id)).aiProvider).toBe('claude');
  });

  it('saves generated chapter metadata and outline fields through the shared path', async () => {
    const project = await createProject(projectInput);
    const updated = await saveGeneratedScript(project.id, [{
      no: 1, title: 'Opening', paragraphs: ['A mystery'], scenesCount: null, durationSec: null,
      role: 'hook', beat: 'Open with a mystery', targetWords: 3, endsOnTension: true,
    }], [{ question: 'What happened?', plantedInChapter: 1, resolvedInChapter: 1 }], {
      hunter: 'A rival', perfectPlan: 'A flawless scheme', blindSpot: 'Arrogance', selfDestruction: 'The plan turns inward',
    }, 'The core question', 'The opening hook');
    expect(updated.version).toBe(project.version + 1);
    expect(updated.status).toBe('script');
    expect(updated.chapters).toHaveLength(1);
    expect(updated.chapters[0]).toMatchObject({ no: 1, status: 'pending', role: 'hook', targetWords: 3, endsOnTension: true });
    expect(updated.chapters[0]!.id).not.toBe('');
    expect(updated.openLoops[0]!.question).toBe('What happened?');
    expect(updated.motif?.hunter).toBe('A rival');
    expect(updated.coreQuestion).toBe('The core question');
    expect(updated.openingHook).toBe('The opening hook');
  });

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

  it('defaults continuity metadata and rejects values outside its bounds', () => {
    const chapter = ChapterDocSchema.parse({
      id: 'chapter-continuity', no: 1, title: 'Continuity', paragraphs: ['Paragraph'],
      status: 'pending', scenesCount: null, durationSec: null,
    });
    expect(chapter).toMatchObject({ chapterSummary: null, avoidRepeating: [], persistentFacts: [], reviewStatus: 'clean' });
    expect(ChapterDocSchema.safeParse({ ...chapter, avoidRepeating: Array.from({ length: 6 }, () => 'Avoid') }).success).toBe(false);
    expect(ChapterDocSchema.safeParse({ ...chapter, avoidRepeating: ['x'.repeat(81)] }).success).toBe(false);
    expect(ChapterDocSchema.safeParse({ ...chapter, persistentFacts: Array.from({ length: 6 }, () => 'Fact') }).success).toBe(false);
    expect(ChapterDocSchema.safeParse({ ...chapter, persistentFacts: ['x'.repeat(121)] }).success).toBe(false);
    expect(ChapterDocSchema.safeParse({ ...chapter, chapterSummary: 'x'.repeat(251) }).success).toBe(false);
  });

  it('defaults narrative metadata and project outline fields for legacy-shaped data', () => {
    const chapter = ChapterDocSchema.parse({
      id: 'chapter-legacy',
      no: 1,
      title: 'Legacy',
      paragraphs: ['Old paragraph'],
      status: 'pending',
      scenesCount: null,
      durationSec: null,
    });
    expect(chapter).toMatchObject({ role: null, beat: '', targetWords: null, endsOnTension: false });

    const detail = ProjectDetailSchema.parse({
      id: 'project-legacy',
      ...projectInput,
      status: 'draft',
      scenes: [],
      chapters: [chapter],
      aiProvider: 'deepseek',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(detail.openLoops).toEqual([]);
    expect(detail.motif).toBeNull();
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

  it('normalizes legacy project documents missing script fields on read', async () => {
    const project = await createProject(projectInput);
    await getCollection<{ _id: string }>('projects').updateOne(
      { _id: project.id },
      { $unset: { aiProvider: 1, chapters: 1, chapterHistory: 1 } },
    );

    const loaded = await getProject(project.id);
    expect(loaded.aiProvider).toBe('deepseek');
    expect(loaded.chapters).toEqual([]);
    expect(await getProjectHistory(project.id)).toEqual([]);
  });

  it('loads a raw legacy project without continuity fields using safe defaults', async () => {
    const project = await createProject(projectInput);
    await getCollection<{ _id: string }>('projects').updateOne(
      { _id: project.id },
      { $set: { chapters: [{ id: 'legacy-chapter', no: 1, title: 'Legacy', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }] }, $unset: { coreQuestion: 1, openingHook: 1 } },
    );
    const loaded = await getProject(project.id);
    expect(loaded.coreQuestion).toBe('');
    expect(loaded.openingHook).toBe('');
    expect(loaded.chapters[0]).toMatchObject({ chapterSummary: null, avoidRepeating: [], persistentFacts: [], reviewStatus: 'clean' });
  });

  it('generates chapters, logs milestones, and sets project status to script', async () => {
    aiMock.chat
      .mockResolvedValueOnce(JSON.stringify({
        chapters: [
      { no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 1, endsOnTension: true },
      { no: 2, title: 'Context', role: 'resolution', beat: 'Close', targetWords: 1, endsOnTension: false },
        ], openLoops: [], coreQuestion: 'What is at stake?', openingHook: 'A compelling opening.',
      }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['First'], styleNote: 'Style 1', chapterSummary: 'First summary', avoidRepeating: [], persistentFactsNext: ['First fact'] }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['Second'], styleNote: 'Style 2', chapterSummary: 'Second summary', avoidRepeating: [], persistentFactsNext: ['Second fact'] }));
    const project = await createProject(projectInput);
    const logs: string[] = [];

    await generateScript(project.id, {
      appendLog: async (message) => { logs.push(message); },
      isCancelled: async () => false,
      reportProgress: async () => undefined,
    });

    const saved = await getProject(project.id);
    expect(saved.status).toBe('script');
    expect(saved.chapters).toHaveLength(2);
    expect(saved.chapters[0]!).toMatchObject({ no: 1, status: 'pending', paragraphs: ['First'], scenesCount: null, durationSec: null });
    expect(saved.chapters[0]!.id).toHaveLength(26);
    expect(await getProjectHistory(project.id)).toEqual([]);
    expect(logs).toEqual([
      'Loading project and AI client…',
      'Sending outline request to AI…',
      'Expanding chapter 1/2…',
      'Expanding chapter 2/2…',
      'Script saved — 2 chapters.',
    ]);
    expect(aiMock.chat).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining(projectInput.brief) })]), expect.objectContaining({ json: true, maxTokens: 4000 }));
  });

  it('maps invalid AI JSON to SCRIPT_PARSE_ERROR without writing chapters', async () => {
    aiMock.chat.mockResolvedValue('{not valid json');
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, { appendLog: vi.fn(), isCancelled: async () => false, reportProgress: vi.fn() })).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR', status: 422 });
    expect((await getProject(project.id)).chapters).toEqual([]);
  });

  it('times out a hanging AI request, logs the readable failure, and leaves the project unchanged', async () => {
    const previous = process.env.AI_REQUEST_TIMEOUT_MS;
    process.env.AI_REQUEST_TIMEOUT_MS = '20';
    const logs: string[] = [];
    aiMock.chat.mockImplementation(() => new Promise<never>(() => undefined));
    const project = await createProject(projectInput);
    try {
      await expect(generateScript(project.id, {
        appendLog: async (message) => { logs.push(message); },
        isCancelled: async () => false,
        reportProgress: vi.fn(),
      })).rejects.toMatchObject({ code: 'AI_REQUEST_FAILED', message: 'Cannot reach api.deepseek.com (timeout/network) for model deepseek-chat.' });
      expect(logs).toContain('AI request failed: Cannot reach api.deepseek.com (timeout/network) for model deepseek-chat.');
      expect((await getProject(project.id)).chapters).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
      else process.env.AI_REQUEST_TIMEOUT_MS = previous;
    }
  });

  it('logs outline validation issues and a bounded raw response before failing', async () => {
    const raw = JSON.stringify({
      chapters: [{ no: 1, title: 'Origins', role: 'introduction', beat: 'Open with a mystery', targetWords: 300, endsOnTension: true }],
      openLoops: [],
      coreQuestion: 'Question'.repeat(100),
      openingHook: 'Hook',
    });
    const logs: string[] = [];
    aiMock.chat.mockResolvedValue(raw);
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, {
      appendLog: async (message) => { logs.push(message); },
      isCancelled: async () => false,
      reportProgress: vi.fn(),
    })).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR', message: expect.stringContaining('chapters.0.role:') });

    expect(logs.some((line) => line.includes('chapters.0.role:') && line.includes(raw.slice(0, 400)))).toBe(true);
    expect(logs.join('\n')).not.toContain(raw.slice(401));
  });

  it('rejects an empty AI chapter list without writing chapters', async () => {
    aiMock.chat.mockResolvedValue('[]');
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, { appendLog: vi.fn(), isCancelled: async () => false, reportProgress: vi.fn() })).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR', status: 422 });
    expect((await getProject(project.id)).chapters).toEqual([]);
    expect((await getProject(project.id)).status).toBe('draft');
  });

  it('streams regeneration chunks, updates the chapter, and snapshots old paragraphs', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    const response = regeneratedResponse();
    aiMock.stream.mockReturnValue((async function* () {
      yield response.slice(0, 20);
      yield response.slice(20);
    })());
    const chunks: string[] = [];

    const updated = await regenerateChapter(project.id, 'chapter-1', { instruction: 'shorter', level: 'light' }, (chunk) => chunks.push(chunk), new AbortController().signal);

    expect(chunks.join('')).toBe(response);
    expect(updated).toMatchObject({ id: 'chapter-1', paragraphs: ['New paragraph'], status: 'pending', reviewStatus: 'clean', chapterSummary: 'New summary', avoidRepeating: ['New avoidance'], persistentFacts: ['New fact'] });
    expect(await getProjectHistory(project.id)).toHaveLength(1);
    expect((await getProjectHistory(project.id))[0]!.chapters[0]!.paragraphs).toEqual(['Old']);
    expect(aiMock.stream).toHaveBeenCalledTimes(1);
  });

  it('retries one short regeneration when there is no user length instruction', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null, targetWords: 10 }], null, 'script');
    const short = regeneratedResponse(['one']);
    const accepted = regeneratedResponse([Array.from({ length: 8 }, (_, index) => `word${index}`).join(' ')]);
    aiMock.stream
      .mockReturnValueOnce((async function* () { yield short; })())
      .mockReturnValueOnce((async function* () { yield accepted; })());

    await regenerateChapter(project.id, 'chapter-1', { instruction: '', level: 'medium' }, vi.fn(), new AbortController().signal);

    expect(aiMock.stream).toHaveBeenCalledTimes(2);
    expect(aiMock.stream.mock.calls[1]![0][1].content).toContain('at least 80% of the target');
    expect(aiMock.stream.mock.calls[1]![0][1].content).toContain('meaningful progression');
    expect((await getProject(project.id)).chapters[0]!.paragraphs[0]).toContain('word7');
  });

  it('does not retry a short regeneration when the user supplied an instruction', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null, targetWords: 10 }], null, 'script');
    aiMock.stream.mockReturnValueOnce((async function* () { yield regeneratedResponse(['one']); })());

    await regenerateChapter(project.id, 'chapter-1', { instruction: 'shorter', level: 'light' }, vi.fn(), new AbortController().signal);

    expect(aiMock.stream).toHaveBeenCalledTimes(1);
  });

  it('passes regeneration narrative context and marks only the next chapter upstream-changed', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [
      { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'pending', scenesCount: null, durationSec: null, chapterSummary: 'Previous summary', avoidRepeating: ['Previous avoidance'], persistentFacts: ['Previous fact'] },
      { id: 'chapter-2', no: 2, title: 'Middle', paragraphs: ['Old middle'], status: 'pending', scenesCount: null, durationSec: null, role: 'rising', beat: 'Escalate', targetWords: 20, endsOnTension: true },
      { id: 'chapter-3', no: 3, title: 'Ending', paragraphs: ['Old ending'], status: 'pending', scenesCount: null, durationSec: null },
    ], null, 'script');
    await replaceProjectScript(project.id, (await getProject(project.id)).chapters, [{ question: 'What changed?', plantedInChapter: 2, resolvedInChapter: 3 }], null, 'Why did the river change?', 'At dawn, it reversed.', null, 'script');
    aiMock.stream.mockReturnValue((async function* () { yield regeneratedResponse(['New middle']); })());

    await regenerateChapter(project.id, 'chapter-2', { instruction: 'deepen', level: 'medium' }, vi.fn(), new AbortController().signal);

    const prompt = aiMock.stream.mock.calls[0]![0][1].content as string;
    expect(prompt).toContain('Core question:');
    expect(prompt).toContain('Role: rising');
    expect(prompt).toContain('Beat: Escalate');
    expect(prompt).toContain('Target words: 20');
    expect(prompt).toContain('Open loops: What changed?');
    expect(prompt).toContain('Previous chapter summary: Previous summary');
    expect(prompt).toContain('Avoid repeating: Previous avoidance');
    expect(prompt).toContain('Persistent facts: Previous fact');
    expect(prompt).not.toContain('Opening hook:');

    const saved = await getProject(project.id);
    expect(saved.chapters[1]).toMatchObject({ reviewStatus: 'clean', chapterSummary: 'New summary', avoidRepeating: ['New avoidance'], persistentFacts: ['New fact'] });
    expect(saved.chapters[2]).toMatchObject({ reviewStatus: 'upstream-changed' });
  });

  it('passes opening hook only to chapter one with empty previous continuity', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    await replaceProjectScript(project.id, (await getProject(project.id)).chapters, [], null, 'Why did it happen?', 'It began at dawn.', null, 'script');
    aiMock.stream.mockReturnValue((async function* () { yield regeneratedResponse(); })());

    await regenerateChapter(project.id, 'chapter-1', { instruction: 'rewrite', level: 'rewrite' }, vi.fn(), new AbortController().signal);

    const prompt = aiMock.stream.mock.calls[0]![0][1].content as string;
    expect(prompt).toContain('Opening hook: It began at dawn.');
    expect(prompt).toContain('Previous chapter summary: (none)');
    expect(prompt).toContain('Avoid repeating: (none)');
    expect(prompt).toContain('Persistent facts: (none)');
  });

  it('regenerates the last chapter without attempting a nonexistent next-chapter update', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Only', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    aiMock.stream.mockReturnValue((async function* () { yield regeneratedResponse(); })());

    await expect(regenerateChapter(project.id, 'chapter-1', { instruction: 'rewrite', level: 'light' }, vi.fn(), new AbortController().signal)).resolves.toMatchObject({ reviewStatus: 'clean' });
    expect(aiMock.stream).toHaveBeenCalledTimes(1);
  });

  it('passes the project model to chapter regeneration', async () => {
    const project = await createProject({ ...projectInput, aiProvider: 'claude', aiModel: 'claude-haiku-4-5-20251001' });
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Only', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    aiMock.stream.mockReturnValue((async function* () { yield regeneratedResponse(); })());

    await regenerateChapter(project.id, 'chapter-1', { instruction: 'rewrite', level: 'light' }, vi.fn(), new AbortController().signal);

    expect(getAiClient).toHaveBeenCalledWith('claude', 'claude-haiku-4-5-20251001');
  });

  it('marks an aborted regeneration needs-fix and leaves old paragraphs unchanged', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [
      { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null },
      { id: 'chapter-2', no: 2, title: 'Context', paragraphs: ['Context'], status: 'pending', scenesCount: null, durationSec: null },
    ], null, 'script');
    const controller = new AbortController();
    let editedResolve!: () => void;
    const edited = new Promise<void>((resolve) => { editedResolve = resolve; });
    aiMock.stream.mockReturnValue((async function* () {
      yield 'partial';
      await patchChapter(project.id, 'chapter-2', { title: 'Edited concurrently' });
      editedResolve();
      await new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new DOMException('Aborted', 'AbortError');
    })());

    const promise = regenerateChapter(project.id, 'chapter-1', { instruction: 'stop', level: 'rewrite' }, vi.fn(), controller.signal);
    await edited;
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect((await getProject(project.id)).chapters).toEqual([
      expect.objectContaining({ id: 'chapter-1', status: 'needs-fix', paragraphs: ['Old'] }),
      expect.objectContaining({ id: 'chapter-2', title: 'Edited concurrently' }),
    ]);
  });

  it('moves an approved chapter back to pending when its paragraphs are edited', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');

    await patchChapter(project.id, 'chapter-1', { paragraphs: ['Edited'] });

    expect((await getProject(project.id)).chapters[0]).toMatchObject({ paragraphs: ['Edited'], status: 'pending' });
  });

  it('marks the next chapter upstream-changed when a paragraph edit invalidates continuity', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [
      { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null },
      { id: 'chapter-2', no: 2, title: 'Close', paragraphs: ['Close'], status: 'approved', scenesCount: null, durationSec: null },
    ], null, 'script');

    await patchChapter(project.id, 'chapter-1', { paragraphs: ['Edited'] });

    expect((await getProject(project.id)).chapters).toEqual([
      expect.objectContaining({ id: 'chapter-1', status: 'pending', reviewStatus: 'clean' }),
      expect.objectContaining({ id: 'chapter-2', reviewStatus: 'upstream-changed' }),
    ]);
  });

  it('clears upstream-changed when that chapter is approved', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null, reviewStatus: 'upstream-changed' }], null, 'script');

    await patchChapter(project.id, 'chapter-1', { status: 'approved' });

    expect((await getProject(project.id)).chapters[0]).toMatchObject({ status: 'approved', reviewStatus: 'clean' });
  });

  it('keeps changed paragraph edits pending when a status is submitted alongside them', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');

    await patchChapter(project.id, 'chapter-1', { paragraphs: ['Edited'], status: 'approved' });

    expect((await getProject(project.id)).chapters[0]).toMatchObject({ paragraphs: ['Edited'], status: 'pending' });
  });

  it('keeps decision-only patches out of content history while recording a changed paragraph edit', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');

    await patchChapter(project.id, 'chapter-1', { status: 'needs-fix' });
    expect(await getProjectHistory(project.id)).toEqual([]);

    await patchChapter(project.id, 'chapter-1', { paragraphs: ['Edited'] });
    expect(await getProjectHistory(project.id)).toEqual([
      expect.objectContaining({ chapters: [expect.objectContaining({ paragraphs: ['Old'], status: 'needs-fix' })] }),
    ]);
  });

  it('does not reset approval or create a snapshot when submitted content is unchanged', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');

    await patchChapter(project.id, 'chapter-1', { paragraphs: ['Old'] });
    await patchChapter(project.id, 'chapter-1', { title: 'Opening' });

    expect((await getProject(project.id)).chapters[0]).toMatchObject({ title: 'Opening', paragraphs: ['Old'], status: 'approved' });
    expect(await getProjectHistory(project.id)).toEqual([]);
  });

  it('records a content snapshot when a title changes', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');

    await patchChapter(project.id, 'chapter-1', { title: 'New opening' });

    expect((await getProject(project.id)).chapters[0]).toMatchObject({ title: 'New opening', status: 'approved' });
    expect(await getProjectHistory(project.id)).toEqual([
      expect.objectContaining({ chapters: [expect.objectContaining({ title: 'Opening' })] }),
    ]);
  });

  it('finalizes approved chapters into scenes and sets status assets', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [
      { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One', 'Two words'], status: 'approved', scenesCount: null, durationSec: null },
      { id: 'chapter-2', no: 2, title: 'Context', paragraphs: ['Three four five six'], status: 'approved', scenesCount: null, durationSec: null },
    ], null, 'script');

    await finalizeScript(project.id);

    const saved = await getProject(project.id);
    expect(saved.status).toBe('assets');
    expect(saved.scenes).toHaveLength(3);
    expect(saved.scenes.every((scene) => scene.visualPrompt === '')).toBe(true);
    expect(saved.scenes.map((scene) => scene.durationSec)).toEqual([1, 1, 2]);
    expect(saved.scenes.reduce((sum, scene) => sum + scene.durationSec, 0)).toBe(4);
    expect(saved.chapters.map((chapter) => chapter.scenesCount)).toEqual([2, 1]);
    expect(await getProjectHistory(project.id)).toHaveLength(1);
  });

  it('drops blank chapter paragraphs on edit and refuses an empty chapter before writing scenes', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');

    await patchChapter(project.id, 'chapter-1', { paragraphs: ['  First paragraph  ', ' ', '\nSecond paragraph\t'] });
    expect((await getProject(project.id)).chapters[0]!.paragraphs).toEqual(['First paragraph', 'Second paragraph']);

    await replaceProjectScript(project.id, [{ ...(await getProject(project.id)).chapters[0]!, paragraphs: ['  ', '\t'] }], [], null, 'Why?', 'The hook must not become narration automatically.', null, 'script');
    await patchChapter(project.id, 'chapter-1', { status: 'approved' });

    await expect(finalizeScript(project.id)).rejects.toMatchObject({
      status: 422,
      code: 'EMPTY_CHAPTER',
      message: 'Chapter 1 "Opening" has no narration paragraphs. Regenerate or edit this chapter before finalizing.',
    });
    expect((await getProject(project.id)).scenes).toEqual([]);
    expect((await getProject(project.id)).status).toBe('script');
  });

  it('traces generation retry, finalize, regeneration, manual edit/import, and final QA end to end', async () => {
    const project = await createProject({ ...projectInput, targetDurationSec: 8 });
    aiMock.chat
      .mockResolvedValueOnce(JSON.stringify({
        chapters: [
          { no: 1, title: 'Opening', role: 'hook', beat: 'Open', targetWords: 2, endsOnTension: true },
          { no: 2, title: 'Close', role: 'resolution', beat: 'Resolve', targetWords: 2, endsOnTension: false },
        ], openLoops: [], coreQuestion: 'What changed?', openingHook: 'At dawn, everything changed.',
      }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['short'], styleNote: 'First', chapterSummary: 'First summary', avoidRepeating: [], persistentFactsNext: ['Fact'] }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['first', 'chapter'], styleNote: 'First retry', chapterSummary: 'First summary', avoidRepeating: ['repeat'], persistentFactsNext: ['Fact'] }))
      .mockResolvedValueOnce(JSON.stringify({ paragraphs: ['second', 'chapter'], styleNote: 'Second', chapterSummary: 'Second summary', avoidRepeating: [], persistentFactsNext: [] }));
    await generateScript(project.id, { appendLog: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), reportProgress: vi.fn() });

    await patchChapter(project.id, 'chapter-missing', { status: 'approved' }).catch(() => undefined);
    const generated = await getProject(project.id);
    await patchChapter(project.id, generated.chapters[0]!.id, { status: 'approved' });
    await patchChapter(project.id, generated.chapters[1]!.id, { status: 'approved' });
    await finalizeScript(project.id);
    expect((await getProject(project.id)).scenes.map((scene) => scene.durationSec)).toEqual([1, 1, 1, 1]);
    expect((await getProject(project.id)).scenes[0]).not.toMatchObject({ chapterSummary: expect.anything(), avoidRepeating: expect.anything(), persistentFacts: expect.anything(), reviewStatus: expect.anything() });

    aiMock.stream.mockReturnValue((async function* () { yield regeneratedResponse(['Regenerated']); })());
    await regenerateChapter(project.id, generated.chapters[0]!.id, { instruction: 'tighten', level: 'light' }, vi.fn(), new AbortController().signal);
    await patchChapter(project.id, generated.chapters[0]!.id, { paragraphs: ['Manual edit'] });
    expect((await getProject(project.id)).chapters[1]).toMatchObject({ reviewStatus: 'upstream-changed' });

    const baseUrl = await startScriptServer();
    const manualDocument = JSON.stringify({
      chapters: [
        { no: 1, title: 'Manual opening', role: 'hook', beat: 'Open', targetWords: 2, endsOnTension: true, paragraphs: ['Manual one'] },
        { no: 2, title: 'Manual close', role: 'resolution', beat: 'Close', targetWords: 2, endsOnTension: false, paragraphs: ['Manual two'] },
      ], openLoops: [], coreQuestion: 'What changed?', openingHook: 'At dawn, everything changed.',
    });
    const importResponse = await fetch(`${baseUrl}/api/project/${project.id}/generate-script/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: manualDocument }),
    });
    expect(importResponse.status).toBe(200);

    aiMock.chat.mockResolvedValueOnce(JSON.stringify({ issues: [] }));
    const qa = await runFinalQa(project.id, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn() });
    expect(qa).toEqual({ issues: [], reviewedBy: { provider: 'deepseek', model: 'deepseek-chat' } });
  });

  it('rejects finalization until every chapter is approved', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    await expect(finalizeScript(project.id)).rejects.toMatchObject({ code: 'NOT_ALL_APPROVED', status: 422 });
  });

  it('rejects finalization when the project has no chapters', async () => {
    const project = await createProject(projectInput);

    await expect(finalizeScript(project.id)).rejects.toMatchObject({ code: 'NO_CHAPTERS', status: 422 });
    expect((await getProject(project.id)).status).toBe('draft');
    expect((await getProject(project.id)).scenes).toEqual([]);
  });

  it('enqueues a generate-script job through the project route', async () => {
    const project = await createProject(projectInput);
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/generate-script`, { method: 'POST' });
    expect(response.status).toBe(201);
    const body = await response.json() as { jobId: string };
    expect(body.jobId).toEqual(expect.any(String));
    expect(await getCollection<JobRecord>('jobs').findOne({ _id: body.jobId })).toMatchObject({ type: 'generate-script', payload: { projectId: project.id } });
  });

  it('reuses an active generate-script job instead of enqueuing a duplicate', async () => {
    const project = await createProject(projectInput);
    const base = await startScriptServer();

    const first = await fetch(`${base}/api/project/${project.id}/generate-script`, { method: 'POST' });
    const firstBody = await first.json() as { jobId: string };
    const second = await fetch(`${base}/api/project/${project.id}/generate-script`, { method: 'POST' });
    const secondBody = await second.json() as { jobId: string };

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
    expect(await getCollection<JobRecord>('jobs').countDocuments({ projectId: project.id, type: 'generate-script' })).toBe(1);
  });

  it('enqueues a visual-prompt job with the exact type and payload for finalized scenes', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{
      id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'approved', scenesCount: 1, durationSec: 60,
    }], null, 'assets');
    await replaceProjectScenes(project.id, [{
      id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 60,
      assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null,
    }], 'assets');
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/generate-visual-prompts`, { method: 'POST' });
    expect(response.status).toBe(201);
    const body = await response.json() as { jobId: string };
    expect(body.jobId).toEqual(expect.any(String));
    expect(await getCollection<JobRecord>('jobs').findOne({ _id: body.jobId })).toMatchObject({
      type: 'generate-visual-prompts', payload: { projectId: project.id },
    });
  });

  it('rejects an unfinalized empty project without enqueueing visual prompts', async () => {
    const project = await createProject(projectInput);
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/generate-visual-prompts`, { method: 'POST' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'SCENES_NOT_READY' } });
    expect(await getCollection<JobRecord>('jobs').countDocuments({ type: 'generate-visual-prompts' })).toBe(0);
  });

  it('rejects visual-prompt generation when a chapter has no scene count', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{
      id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'approved', scenesCount: null, durationSec: null,
    }], null, 'script');
    await replaceProjectScenes(project.id, [{
      id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 60,
      assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null,
    }], 'assets');
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/generate-visual-prompts`, { method: 'POST' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'SCENES_NOT_READY' } });
    expect(await getCollection<JobRecord>('jobs').countDocuments({ type: 'generate-visual-prompts' })).toBe(0);
  });

  it('rejects visual-prompt generation when chapter scene counts do not sum to scenes', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{
      id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'approved', scenesCount: 2, durationSec: 60,
    }], null, 'script');
    await replaceProjectScenes(project.id, [{
      id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 60,
      assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null,
    }], 'assets');
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/generate-visual-prompts`, { method: 'POST' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'SCENES_NOT_READY' } });
    expect(await getCollection<JobRecord>('jobs').countDocuments({ type: 'generate-visual-prompts' })).toBe(0);
  });

  it('patches a chapter and returns the refreshed chapter list', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/chapters/chapter-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { chapters: Array<{ status: string }> }).chapters[0]!.status).toBe('approved');
  });

  it('accepts pending status when a review decision is toggled off', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/chapters/chapter-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'pending' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json() as { chapters: Array<{ status: string }> }).chapters[0]!.status).toBe('pending');
  });

  it('returns history newest-first and restores a selected snapshot', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    await fetch(`${(await startScriptServer())}/api/project/${project.id}/chapters/chapter-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paragraphs: ['New'] }),
    });
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const history = await fetch(`${base}/api/project/${project.id}/chapters/history`);
    expect(history.status).toBe(200);
    expect((await history.json() as Array<{ chapters: Array<{ paragraphs: string[] }> }>)[0]!.chapters[0]!.paragraphs).toEqual(['Old']);

    const restored = await fetch(`${base}/api/project/${project.id}/chapters/restore`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ index: 0 }),
    });
    expect(restored.status).toBe(200);
    expect((await restored.json() as { chapters: Array<{ paragraphs: string[] }> }).chapters[0]!.paragraphs).toEqual(['Old']);
  });

  it('finalizes through the route and returns scenes with assets status', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/finalize-script`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'assets', scenes: [expect.objectContaining({ narration: 'One' })] });
  });

  it('streams regeneration chunks and one done event over SSE', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    aiMock.stream.mockReturnValue((async function* () {
      yield regeneratedResponse(['New']);
    })());
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/chapters/chapter-1/regenerate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'rewrite', level: 'rewrite' }),
    });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('event: chunk\ndata: "{\\"paragraphs\\":[\\"New\\"],\\"chapterSummary\\":\\"New summary\\"');
    expect(text.match(/event: done/g)).toHaveLength(1);
    expect(text).toContain('"paragraphs":["New"]');
  });

  it('prunes chapter history to the ten newest snapshots', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    for (let index = 0; index < 11; index += 1) {
      await patchChapter(project.id, 'chapter-1', { title: `Version ${index}` });
    }
    const history = await getProjectHistory(project.id);
    expect(history).toHaveLength(10);
    expect(history[0]!.chapters[0]!.title).toBe('Version 9');
    expect(history[9]!.chapters[0]!.title).toBe('Version 0');
  });

  it('rejects an out-of-range restore index with a typed route error', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    const base = await startScriptServer();
    const response = await fetch(`${base}/api/project/${project.id}/chapters/restore`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ index: 0 }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_HISTORY_INDEX' } });
  });

  it('estimates each finalized scene from narration words instead of target duration', async () => {
    const project = await createProject({ ...projectInput, targetDurationSec: 61 });
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One', 'Two words', 'Four words here now'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');
    await finalizeScript(project.id);
    const saved = await getProject(project.id);
    expect(saved.scenes.map((scene) => scene.durationSec)).toEqual([1, 1, 2]);
    expect(saved.chapters[0]!.durationSec).toBe(4);
    expect(saved.chapters[0]!.scenesCount).toBe(3);
  });

  it('enqueues a scene-split job with the exact type and payload for finalized scenes', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{
      id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'approved', scenesCount: 1, durationSec: 1,
    }], null, 'assets');
    await replaceProjectScenes(project.id, [{
      id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 1,
      assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null,
    }], 'assets');
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/split`, { method: 'POST' });
    expect(response.status).toBe(201);
    const body = await response.json() as { jobId: string };
    expect(body.jobId).toEqual(expect.any(String));
    expect(await getCollection<JobRecord>('jobs').findOne({ _id: body.jobId })).toMatchObject({
      type: 'split-scenes', payload: { projectId: project.id },
    });
  });

  it('rejects an unfinalized project without enqueueing scene splitting', async () => {
    const project = await createProject(projectInput);
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/scenes/split`, { method: 'POST' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'SCENES_NOT_READY' } });
    expect(await getCollection<JobRecord>('jobs').countDocuments({ type: 'split-scenes' })).toBe(0);
  });

  it('emits an SSE error frame when streamed AI output is invalid', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    aiMock.stream.mockReturnValue((async function* () { yield 'not json'; })());
    const base = await startScriptServer();
    const response = await fetch(`${base}/api/project/${project.id}/chapters/chapter-1/regenerate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'bad', level: 'light' }),
    });
    const text = await response.text();
    expect(text).toContain('event: error');
    expect(text).toContain('AI returned invalid script structure: root: invalid JSON');
    expect(text.match(/event: done/g)).toBeNull();
  });
});
