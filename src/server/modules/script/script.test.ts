import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Collection } from 'mongodb';
import { CreateProjectRequestSchema, ProjectDetailSchema } from '../../../contracts/project';
import { ChapterDocSchema, ChapterSnapshotSchema } from '../../../contracts/script';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';
import { applyEmptySceneVisualPrompts, applyEmptySceneVisualPromptsWithResult, createProject, getProject, getProjectHistory, patchProjectScene, replaceProjectChapters, replaceProjectScenes } from '../project';
import { finalizeScript, generateScript, patchChapter, regenerateChapter } from './service';

const aiMock = vi.hoisted(() => ({ chat: vi.fn(), stream: vi.fn() }));
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

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  await getCollection('jobs').deleteMany({});
  aiMock.chat.mockReset();
  aiMock.stream.mockReset();
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
    { id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 10, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null },
    { id: 'scene-2', narration: 'Two', visualPrompt: '', durationSec: 10, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null },
    { id: 'scene-3', narration: 'Three', visualPrompt: 'Manual prompt', durationSec: 10, assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null },
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

  it('generates chapters, logs milestones, and sets project status to script', async () => {
    aiMock.chat.mockResolvedValue(JSON.stringify([
      { no: 1, title: 'Opening', paragraphs: ['First', 'Second'], scenesCount: null, durationSec: null },
      { no: 2, title: 'Context', paragraphs: ['Third'], scenesCount: null, durationSec: null },
    ]));
    const project = await createProject(projectInput);
    const logs: string[] = [];

    await generateScript(project.id, async (message) => { logs.push(message); });

    const saved = await getProject(project.id);
    expect(saved.status).toBe('script');
    expect(saved.chapters).toHaveLength(2);
    expect(saved.chapters[0]!).toMatchObject({ no: 1, status: 'pending', scenesCount: null, durationSec: null });
    expect(saved.chapters[0]!.id).toHaveLength(26);
    expect(await getProjectHistory(project.id)).toEqual([]);
    expect(logs).toEqual([
      'Loading project and AI client…',
      'Sending request to AI…',
      'Parsing AI response…',
      'Script saved — 2 chapters.',
    ]);
    expect(aiMock.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining(projectInput.brief) }),
    ]));
  });

  it('maps invalid AI JSON to SCRIPT_PARSE_ERROR without writing chapters', async () => {
    aiMock.chat.mockResolvedValue('{not valid json');
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, vi.fn())).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR', status: 422 });
    expect((await getProject(project.id)).chapters).toEqual([]);
  });

  it('rejects an empty AI chapter list without writing chapters', async () => {
    aiMock.chat.mockResolvedValue('[]');
    const project = await createProject(projectInput);

    await expect(generateScript(project.id, vi.fn())).rejects.toMatchObject({ code: 'SCRIPT_PARSE_ERROR', status: 422 });
    expect((await getProject(project.id)).chapters).toEqual([]);
    expect((await getProject(project.id)).status).toBe('draft');
  });

  it('streams regeneration chunks, updates the chapter, and snapshots old paragraphs', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['Old'], status: 'pending', scenesCount: null, durationSec: null }], null, 'script');
    aiMock.stream.mockReturnValue((async function* () {
      yield '{"paragraphs":["New ';
      yield 'paragraph"]}';
    })());
    const chunks: string[] = [];

    const updated = await regenerateChapter(project.id, 'chapter-1', { instruction: 'shorter', level: 'light' }, (chunk) => chunks.push(chunk), new AbortController().signal);

    expect(chunks).toEqual(['{"paragraphs":["New ', 'paragraph"]}']);
    expect(updated).toMatchObject({ id: 'chapter-1', paragraphs: ['New paragraph'], status: 'pending' });
    expect(await getProjectHistory(project.id)).toHaveLength(1);
    expect((await getProjectHistory(project.id))[0]!.chapters[0]!.paragraphs).toEqual(['Old']);
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
      { id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One', 'Two'], status: 'approved', scenesCount: null, durationSec: null },
      { id: 'chapter-2', no: 2, title: 'Context', paragraphs: ['Three'], status: 'approved', scenesCount: null, durationSec: null },
    ], null, 'script');

    await finalizeScript(project.id);

    const saved = await getProject(project.id);
    expect(saved.status).toBe('assets');
    expect(saved.scenes).toHaveLength(3);
    expect(saved.scenes.every((scene) => scene.visualPrompt === '')).toBe(true);
    expect(saved.scenes.reduce((sum, scene) => sum + scene.durationSec, 0)).toBe(60);
    expect(saved.chapters.map((chapter) => chapter.scenesCount)).toEqual([2, 1]);
    expect(await getProjectHistory(project.id)).toHaveLength(1);
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

  it('enqueues a visual-prompt job with the exact type and payload for finalized scenes', async () => {
    const project = await createProject(projectInput);
    await replaceProjectChapters(project.id, [{
      id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One'], status: 'approved', scenesCount: 1, durationSec: 60,
    }], null, 'assets');
    await replaceProjectScenes(project.id, [{
      id: 'scene-1', narration: 'One', visualPrompt: '', durationSec: 60,
      assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null,
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
      assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null,
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
      assetType: 'image', assetFileId: null, audioFileId: null, sfxPrompt: '', sfxFileId: null,
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
      yield '{"paragraphs":["New"]}';
    })());
    const base = await startScriptServer();

    const response = await fetch(`${base}/api/project/${project.id}/chapters/chapter-1/regenerate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'rewrite', level: 'rewrite' }),
    });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('event: chunk\ndata: "{\\"paragraphs\\":[\\"New\\"]}"');
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

  it('distributes a non-even target duration without losing seconds', async () => {
    const project = await createProject({ ...projectInput, targetDurationSec: 61 });
    await replaceProjectChapters(project.id, [{ id: 'chapter-1', no: 1, title: 'Opening', paragraphs: ['One', 'Two', 'Three'], status: 'approved', scenesCount: null, durationSec: null }], null, 'script');
    await finalizeScript(project.id);
    const saved = await getProject(project.id);
    expect(saved.scenes.map((scene) => scene.durationSec)).toEqual([21, 20, 20]);
    expect(saved.chapters[0]!.scenesCount).toBe(3);
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
    expect(text).toContain('AI returned invalid script structure.');
    expect(text.match(/event: done/g)).toBeNull();
  });
});
