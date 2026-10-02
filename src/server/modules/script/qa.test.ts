import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { QAResultSchema } from './ai/qa-schema';
import { buildQaPrompt } from './ai/build-prompt';
import { runFinalQa } from './qa';
import { createProject, getProject, replaceProjectChapters } from '../project';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createApp } from '../../app';

type JobRecord = { _id: string; type: string; projectId: string; payload: unknown };

const aiMock = vi.hoisted(() => ({ model: 'deepseek-chat', chat: vi.fn() }));
vi.mock('../../shared/ai', () => ({ getAiClient: vi.fn(() => aiMock) }));

const projectInput = {
  title: 'QA project', brief: 'A project for final quality assurance.', language: 'en' as const,
  referencesText: '', scriptPresetId: 'documentary' as const, targetDurationSec: 60,
  chapterCount: 1, voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

const qaJson = JSON.stringify({ issues: [{
  chapter: 1, type: 'POSSIBLE_FILLER', severity: 'medium', reason: 'The chapter repeats information.', suggestedAction: 'SHORTEN',
}] });

beforeAll(() => startTestMongo());
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  await getCollection('jobs').deleteMany({});
  aiMock.chat.mockReset();
});
afterAll(() => closeTestMongo());

function context() {
  return { reportProgress: vi.fn().mockResolvedValue(undefined), isCancelled: vi.fn().mockResolvedValue(false), appendLog: vi.fn().mockResolvedValue(undefined) };
}

describe('final QA contract', () => {
  it('requests issue reasons in the project language while keeping enum tokens in English', async () => {
    const project = await createProject({ ...projectInput, language: 'vi' });
    const vietnamese = buildQaPrompt(await getProject(project.id));
    const english = buildQaPrompt({ ...(await getProject(project.id)), language: 'en' });
    const enumTokens = 'REPETITION, CONTRADICTION, DEAD_CHAPTER, POSSIBLE_FILLER, WEAK_HOOK, FLAT_PACING, PREMATURE_REVEAL, UNRESOLVED_LOOP, WEAK_PAYOFF, AWKWARD_TRANSITION, TONE_DRIFT, CREDIBILITY_RISK';

    expect(vietnamese.user).toContain('Write each issue reason in Vietnamese.');
    expect(english.user).toContain('Write each issue reason in English.');
    expect(vietnamese.system).toContain(enumTokens);
    expect(vietnamese.system).toContain('REMOVE_DUPLICATION, REGENERATE, SHORTEN, MOVE_REVEAL, REVIEW_FACT');
  });

  it('parses a well-formed result with all supported issue types and actions', () => {
    const result = QAResultSchema.parse({
      issues: [
        'REPETITION', 'CONTRADICTION', 'DEAD_CHAPTER', 'POSSIBLE_FILLER', 'WEAK_HOOK', 'FLAT_PACING',
        'PREMATURE_REVEAL', 'UNRESOLVED_LOOP', 'WEAK_PAYOFF', 'AWKWARD_TRANSITION', 'TONE_DRIFT', 'CREDIBILITY_RISK',
      ].map((type, index) => ({
        chapter: index + 1, type, severity: ['low', 'medium', 'high'][index % 3], reason: `Reason ${index}`,
        suggestedAction: ['REMOVE_DUPLICATION', 'REGENERATE', 'SHORTEN', 'MOVE_REVEAL', 'REVIEW_FACT'][index % 5],
      })),
    });
    expect(result.issues).toHaveLength(12);
  });

  it('parses results with or without optional reviewer metadata', () => {
    expect(QAResultSchema.parse({ issues: [] })).toEqual({ issues: [] });
    expect(QAResultSchema.parse({ issues: [], reviewedBy: { provider: 'deepseek', model: 'deepseek-chat' } })).toMatchObject({
      reviewedBy: { provider: 'deepseek', model: 'deepseek-chat' },
    });
    expect(QAResultSchema.parse({ issues: [], reviewedBy: { provider: 'manual', model: 'Dán thủ công' } })).toMatchObject({
      reviewedBy: { provider: 'manual', model: 'Dán thủ công' },
    });
  });

  it.each([
    ['type', { type: 'UNKNOWN' }], ['severity', { severity: 'urgent' }], ['suggestedAction', { suggestedAction: 'FIX_IT' }],
  ])('rejects an invalid %s enum value', (_field, override) => {
    expect(() => QAResultSchema.parse({ issues: [{ chapter: 1, type: 'REPETITION', severity: 'low', reason: 'Reason', suggestedAction: 'SHORTEN', ...override }] })).toThrow();
  });

  it('rejects score-like extra fields', () => {
    expect(() => QAResultSchema.parse({ issues: [], score: 0.5 })).toThrow();
    expect(() => QAResultSchema.parse({ issues: [{ chapter: 1, type: 'REPETITION', severity: 'low', reason: 'Reason', suggestedAction: 'SHORTEN', score: 1 }] })).toThrow();
    expect(() => QAResultSchema.parse({ issues: [], reviewedBy: { provider: 'manual', model: 'Dán thủ công', extra: true } })).toThrow();
  });
});

describe('runFinalQa', () => {
  it('returns parsed issues without mutating the project', async () => {
    const project = await createProject(projectInput);
    const before = await getProject(project.id);
    aiMock.chat.mockResolvedValue(qaJson);
    const jobContext = context();

    const result = await runFinalQa(project.id, jobContext);

    expect(result).toEqual({ ...JSON.parse(qaJson), reviewedBy: { provider: 'deepseek', model: 'deepseek-chat' } });
    expect(await getProject(project.id)).toEqual(before);
    expect(aiMock.chat).toHaveBeenCalledOnce();
    expect(jobContext.appendLog).toHaveBeenCalledWith('Final QA finished by deepseek/deepseek-chat: 1 issue found.');
    const system = aiMock.chat.mock.calls[0]![0][0].content as string;
    const user = aiMock.chat.mock.calls[0]![0][1].content as string;
    expect(system).toContain('REPETITION, CONTRADICTION, DEAD_CHAPTER, POSSIBLE_FILLER, WEAK_HOOK, FLAT_PACING, PREMATURE_REVEAL, UNRESOLVED_LOOP, WEAK_PAYOFF, AWKWARD_TRANSITION, TONE_DRIFT, CREDIBILITY_RISK');
    expect(system).toContain('REMOVE_DUPLICATION, REGENERATE, SHORTEN, MOVE_REVEAL, REVIEW_FACT');
    expect(user).toContain('Chapter Deletion Test');
  });

  it('keeps cancelled QA results unchanged and does not call the AI client', async () => {
    const project = await createProject(projectInput);
    const cancelled = { ...context(), isCancelled: vi.fn().mockResolvedValue(true) };

    await expect(runFinalQa(project.id, cancelled)).resolves.toEqual({ issues: [] });
    expect(aiMock.chat).not.toHaveBeenCalled();
  });
});

describe('final QA route', () => {
  let server: Server | null = null;

  async function startServer(): Promise<string> {
    const app = createApp({ filesDir: './data/files', clientDir: null });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  async function addChapter(projectId: string): Promise<void> {
    await replaceProjectChapters(projectId, [{
      id: 'chapter-1', no: 1, title: 'Chapter one', paragraphs: ['Text'], status: 'approved', scenesCount: null, durationSec: null,
      role: null, beat: '', targetWords: null, endsOnTension: false, chapterSummary: null, avoidRepeating: [], persistentFacts: [], reviewStatus: 'clean',
    }], null);
  }

  afterEach(async () => {
    const current = server;
    server = null;
    if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
  });

  it('enqueues exactly one final-qa job and returns its id', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();

    const response = await fetch(`${base}/api/project/${project.id}/qa`, { method: 'POST' });
    expect(response.status).toBe(201);
    const body = await response.json() as { jobId: string };
    expect(body.jobId).toEqual(expect.any(String));
    expect(await getCollection('jobs').countDocuments({ type: 'final-qa' })).toBe(1);
    expect(await getCollection<JobRecord>('jobs').findOne({ _id: body.jobId })).toMatchObject({
      type: 'final-qa', projectId: project.id, payload: { projectId: project.id },
    });
  });

  it('returns the exact manual prompt without creating a job', async () => {
    const project = await createProject(projectInput);
    const expected = buildQaPrompt(await getProject(project.id));
    const base = await startServer();

    const response = await fetch(`${base}/api/project/${project.id}/qa/manual-prompt`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      prompt: `SYSTEM\n${expected.system}\n\nUSER\n${expected.user}`,
      promptVersion: expected.promptVersion,
    });
    expect(await getCollection('jobs').countDocuments({})).toBe(0);
    expect(aiMock.chat).not.toHaveBeenCalled();
  });

  it('imports fenced manual JSON, validates chapters, and overwrites pasted reviewer metadata', async () => {
    const project = await createProject(projectInput);
    await addChapter(project.id);
    const base = await startServer();
    const raw = `\`\`\`json\n${JSON.stringify({
      issues: [{ chapter: 1, type: 'REPETITION', severity: 'low', reason: 'Lặp ý.', suggestedAction: 'SHORTEN' }],
      reviewedBy: { provider: 'deepseek', model: 'pasted-model' },
    })}\n\`\`\``;

    const response = await fetch(`${base}/api/project/${project.id}/qa/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      issues: [{ chapter: 1, type: 'REPETITION', severity: 'low', reason: 'Lặp ý.', suggestedAction: 'SHORTEN' }],
      reviewedBy: { provider: 'manual', model: 'Dán thủ công' },
    });
  });

  it('rejects broken JSON, extra keys, and issue chapters outside the project', async () => {
    const project = await createProject(projectInput);
    await addChapter(project.id);
    const base = await startServer();
    const post = (raw: string) => fetch(`${base}/api/project/${project.id}/qa/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
    });

    const broken = await post('{not json');
    expect(broken.status).toBe(422);
    expect(await broken.json()).toMatchObject({ error: { code: 'SCRIPT_PARSE_ERROR' } });

    const extra = await post(JSON.stringify({ issues: [], extra: true }));
    expect(extra.status).toBe(422);
    expect(await extra.json()).toMatchObject({ error: { code: 'SCRIPT_PARSE_ERROR' } });

    const outOfRange = await post(JSON.stringify({ issues: [{ chapter: 2, type: 'REPETITION', severity: 'low', reason: 'Lặp ý.', suggestedAction: 'SHORTEN' }] }));
    expect(outOfRange.status).toBe(422);
    expect(await outOfRange.json()).toMatchObject({ error: { code: 'QA_CHAPTER_OUT_OF_RANGE', message: expect.stringContaining('2') } });
  });
});
