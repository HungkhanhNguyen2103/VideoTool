import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiClient } from '../../shared/ai';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, getProject, patchProjectScene, replaceProjectScenes, setProjectSceneActive, setSceneWordTimings } from '../project';
import { analyzeProjectNameKeywords, NAME_KEYWORD_SYSTEM_PROMPT } from './name-keyword-service';
import { selectProjectSceneKeywords } from './keywords';

const projectInput = {
  title: 'Name keyword test', brief: 'A test project brief long enough for validation.', language: 'vi' as const,
  referencesText: '', scriptPresetId: 'documentary' as const, targetDurationSec: 30, chapterCount: 1, voiceId: null,
  aiProvider: 'claude' as const, renderSettings: { aspect: '16:9' as const, width: 1280, height: 720, fps: 24 as const },
  aiModel: 'claude-haiku-4-5-20251001',
};

function fakeClient(chat: AiClient['chat']) {
  return { client: { model: 'fake-model', chat, async *stream() { /* not used */ } } satisfies AiClient };
}

async function seedProject() {
  const project = await createProject(projectInput);
  await replaceProjectScenes(project.id, [
    { id: 'scene-1', narration: 'Trên sông Tiền, quân ta tiến lên.', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
    { id: 'scene-2', narration: 'Một cảnh chưa có căn chỉnh.', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: 'asset-2', audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null },
  ]);
  await patchProjectScene(project.id, 'scene-1', { audioFileId: 'audio-1' });
  await setSceneWordTimings(project.id, 'scene-1', 'audio-1', 'Trên sông Tiền, quân ta tiến lên.', {
    audioFileId: 'audio-1', words: [
      { text: 'Trên', startSec: 0, endSec: .2 }, { text: 'sông', startSec: .3, endSec: .5 },
      { text: 'Tiền,', startSec: .5, endSec: .7 }, { text: 'quân', startSec: 1, endSec: 1.2 },
      { text: 'ta', startSec: 1.2, endSec: 1.4 }, { text: 'tiến', startSec: 3, endSec: 3.2 },
      { text: 'lên.', startSec: 5, endSec: 5.2 },
    ],
  });
  return getProject(project.id);
}

beforeAll(async () => { await startTestMongo(); });
beforeEach(async () => { await resetTestMongo(); });
afterAll(async () => { await closeTestMongo(); });

describe('analyzeProjectNameKeywords', () => {
  it('requests eligible scenes once and persists validated candidates with provider and model', async () => {
    const seeded = await seedProject();
    await setProjectSceneActive(seeded.id, 'scene-2', false);
    const project = await getProject(seeded.id);
    const chat = vi.fn().mockResolvedValue(JSON.stringify({ scenes: [
      { scene: 1, candidates: [{ phrase: 'Sông Tiền', kind: 'place' }] },
    ] }));
    const { client } = fakeClient(chat);
    const resolver = vi.fn(() => client);

    const summary = await analyzeProjectNameKeywords(project.id, resolver);

    expect(summary).toMatchObject({ scenesAnalyzed: 1, scenesSkippedNoTimings: 0, scenesWithName: 1, rejectedCandidates: 0, provider: 'claude', model: 'fake-model', skippedInactive: 1 });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(expect.any(Array), { json: true, maxTokens: 8000, temperature: 0 });
    expect(chat.mock.calls[0]![0][1]!.content).not.toContain('Scene 2');
    expect(resolver).toHaveBeenCalledWith('claude', 'claude-haiku-4-5-20251001');
    const refreshed = (await getProject(project.id)).scenes[0]!;
    expect(refreshed.nameCandidates).toMatchObject({
      audioFileId: 'audio-1', provider: 'claude', model: 'fake-model', candidates: [{ phrase: 'Sông Tiền', kind: 'place' }],
    });
    expect(selectProjectSceneKeywords([refreshed])[0]!.popup).toBeNull();
  });

  it('retries once when the response is invalid JSON', async () => {
    const project = await seedProject();
    const chat = vi.fn().mockResolvedValueOnce('not JSON').mockResolvedValueOnce(JSON.stringify({ scenes: [
      { scene: 1, candidates: [{ phrase: 'Sông Tiền', kind: 'place' }] },
    ] }));
    const { client } = fakeClient(chat);

    await analyzeProjectNameKeywords(project.id, () => client);

    expect(chat).toHaveBeenCalledTimes(2);
    expect((await getProject(project.id)).scenes[0]!.nameCandidates?.candidates).toEqual([{ phrase: 'Sông Tiền', kind: 'place' }]);
  });

  it('does not retry valid JSON that fails the response schema', async () => {
    const project = await seedProject();
    const chat = vi.fn().mockResolvedValue(JSON.stringify({ scenes: [
      { scene: 1, candidates: [{ phrase: 'Sông Tiền' }] },
    ] }));
    const { client } = fakeClient(chat);

    await expect(analyzeProjectNameKeywords(project.id, () => client)).rejects.toMatchObject({ code: 'NAME_KEYWORD_ANALYSIS_FAILED', status: 422 });

    expect(chat).toHaveBeenCalledTimes(1);
    expect((await getProject(project.id)).scenes[0]!.nameCandidates).toBeNull();
  });

  it('persists a valid empty candidate list to clear old results', async () => {
    const project = await seedProject();
    const prior = {
      narrationHash: 'previous-hash', audioFileId: 'audio-1', provider: 'claude' as const, model: 'old-model',
      generatedAt: '2026-10-06T00:00:00.000Z', candidates: [{ phrase: 'Quân Xiêm', kind: 'group' as const }],
    };
    const { setProjectSceneNameCandidates } = await import('../project');
    await setProjectSceneNameCandidates(project.id, [{ sceneId: 'scene-1', expectedNarration: 'Trên sông Tiền, quân ta tiến lên.', expectedAudioFileId: 'audio-1', nameCandidates: prior }]);
    const chat = vi.fn().mockResolvedValue(JSON.stringify({ scenes: [{ scene: 1, candidates: [] }] }));
    const { client } = fakeClient(chat);

    const summary = await analyzeProjectNameKeywords(project.id, () => client);
    const refreshed = (await getProject(project.id)).scenes[0]!;

    expect(summary).toMatchObject({ scenesWithName: 0, rejectedCandidates: 0 });
    expect(refreshed.nameCandidates).toMatchObject({ narrationHash: expect.any(String), audioFileId: 'audio-1', candidates: [] });
    expect(selectProjectSceneKeywords([refreshed])[0]!.popup).toBeNull();
  });

  it('leaves stored candidates untouched after both JSON attempts fail', async () => {
    const project = await seedProject();
    const prior = {
      narrationHash: 'previous-hash', audioFileId: 'audio-1', provider: 'claude' as const, model: 'old-model',
      generatedAt: '2026-10-06T00:00:00.000Z', candidates: [{ phrase: 'Quân Xiêm', kind: 'group' as const }],
    };
    const { setProjectSceneNameCandidates } = await import('../project');
    await setProjectSceneNameCandidates(project.id, [{ sceneId: 'scene-1', expectedNarration: 'Trên sông Tiền, quân ta tiến lên.', expectedAudioFileId: 'audio-1', nameCandidates: prior }]);
    const chat = vi.fn().mockResolvedValue('not JSON');
    const { client } = fakeClient(chat);

    await expect(analyzeProjectNameKeywords(project.id, () => client)).rejects.toMatchObject({ code: 'NAME_KEYWORD_ANALYSIS_FAILED', status: 422 });

    expect(chat).toHaveBeenCalledTimes(2);
    expect((await getProject(project.id)).scenes[0]!.nameCandidates).toEqual(prior);
  });

  it('does not write when every returned candidate fails narration/timing validation', async () => {
    const project = await seedProject();
    const chat = vi.fn().mockResolvedValue(JSON.stringify({ scenes: [
      { scene: 1, candidates: [{ phrase: 'Sông Hậu', kind: 'place' }] },
    ] }));
    const { client } = fakeClient(chat);

    await expect(analyzeProjectNameKeywords(project.id, () => client)).rejects.toMatchObject({ code: 'NAME_CANDIDATES_REJECTED', status: 422 });

    expect((await getProject(project.id)).scenes[0]!.nameCandidates).toBeNull();
  });

  it('pins the Task 81 extraction rules and the approved ranking/phrase guidance', () => {
    expect(NAME_KEYWORD_SYSTEM_PROMPT).toContain('ordered by importance, most important first');
    expect(NAME_KEYWORD_SYSTEM_PROMPT).toContain('When several names are equally important, order them by first appearance in the narration.');
    expect(NAME_KEYWORD_SYSTEM_PROMPT).toContain('Copy each phrase verbatim from the narration');
    expect(NAME_KEYWORD_SYSTEM_PROMPT).toContain('generic nouns such as "trận đánh" or "quân đội"');
    expect(NAME_KEYWORD_SYSTEM_PROMPT).toContain('A role is a title before a person\'s name, such as "Tướng" or "Vua"');
    expect(NAME_KEYWORD_SYSTEM_PROMPT).toContain('Omit candidates when no important named entity is present');
    expect(NAME_KEYWORD_SYSTEM_PROMPT).toContain('"Sông Tiền", "Trận Rạch Gầm", "Quân Xiêm"');
  });
});
