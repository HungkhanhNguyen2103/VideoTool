import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { getCollection } from '../../db/client';
import { errorHandler } from '../../error-handler';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, getProject, replaceProjectChapters, setProjectChannel } from '../project';
import { createChannel } from '../channel';
import { createFileStoreService } from '../file-store';
import { configureSeoModule, createSeoRouter } from './routes';

const projectInput = {
  title: 'SEO route project',
  brief: 'A sufficiently long brief for SEO route tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1280, height: 720, fps: 24 as const },
};

const seoRaw = JSON.stringify({
  titles: [{ text: 'Một tiêu đề trung thực', angle: 'curiosity' }],
  tags: ['lịch sử', 'chiến dịch'],
  hashtags: ['#LichSu'],
});

let filesDir = '';
let server: Server | null = null;

beforeAll(async () => {
  await startTestMongo();
  filesDir = await mkdtemp(path.join(tmpdir(), 'seo-routes-'));
});
beforeEach(async () => {
  await getCollection('projects').deleteMany({});
  await getCollection('jobs').deleteMany({});
  await getCollection('files').deleteMany({});
  await getCollection('channels').deleteMany({});
  configureSeoModule(filesDir);
});
afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
});
afterAll(async () => {
  await closeTestMongo();
  if (filesDir) await rm(filesDir, { recursive: true, force: true });
});

async function startSeoServer(
  enqueueJob = vi.fn().mockResolvedValue({ id: 'job-1' }),
  getActiveJob = vi.fn().mockResolvedValue(null),
): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/api/project', createSeoRouter({ enqueueJob, getActiveJob }));
  app.use(errorHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function projectWithChapter() {
  const project = await createProject(projectInput);
  await replaceProjectChapters(project.id, [{
    id: 'chapter-1', no: 1, title: 'Mở đầu', paragraphs: ['Mở đầu'], status: 'approved', scenesCount: 0, durationSec: 0,
  }], null, 'script');
  return getProject(project.id);
}

describe('SEO routes and thumbnail files', () => {
  it('rejects generation until the project has chapters, then enqueues and deduplicates active jobs', async () => {
    const empty = await createProject(projectInput);
    const enqueueJob = vi.fn().mockResolvedValue({ id: 'job-new' });
    const getActiveJob = vi.fn().mockResolvedValue(null);
    const base = await startSeoServer(enqueueJob, getActiveJob);
    const notReady = await fetch(`${base}/api/project/${empty.id}/seo/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    expect(notReady.status).toBe(422);
    expect(await notReady.json()).toMatchObject({ error: { code: 'SCRIPT_NOT_READY' } });

    const project = await projectWithChapter();
    const generated = await fetch(`${base}/api/project/${project.id}/seo/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sections: ['titles', 'tags'] }) });
    expect(generated.status).toBe(201);
    expect(await generated.json()).toEqual({ jobId: 'job-new' });
    expect(enqueueJob).toHaveBeenCalledWith({ type: 'generate-seo', projectId: project.id, payload: { projectId: project.id, sections: ['titles', 'tags'] } });

    getActiveJob.mockResolvedValue({ id: 'job-existing' });
    const duplicate = await fetch(`${base}/api/project/${project.id}/seo/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ jobId: 'job-existing' });
  });

  it('serves manual prompts, imports selected sections, patches partial fields, and translates invalid JSON', async () => {
    const project = await projectWithChapter();
    const base = await startSeoServer();
    const prompt = await fetch(`${base}/api/project/${project.id}/seo/manual-prompt?sections=titles,tags`);
    expect(prompt.status).toBe(200);
    expect(await prompt.json()).toMatchObject({ prompt: expect.stringContaining('SYSTEM'), promptVersion: 'seo-prompt-v1/seo-documentary@8' });

    const imported = await fetch(`${base}/api/project/${project.id}/seo/manual-import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: seoRaw, sections: ['titles', 'tags'] }) });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ seo: { titles: [{ id: 'title-1' }], tags: ['lịch sử', 'chiến dịch'], generatedBy: { provider: 'manual' } } });

    const patched = await fetch(`${base}/api/project/${project.id}/seo`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descriptionIntro: 'Mô tả tay.' }) });
    expect(patched.status).toBe(200);
    expect((await patched.json()).seo.descriptionIntro).toBe('Mô tả tay.');

    const invalid = await fetch(`${base}/api/project/${project.id}/seo/manual-import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: '{', sections: ['titles'] }) });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: { code: 'SEO_PARSE_ERROR', message: expect.stringContaining('JSON của gói SEO không hợp lệ') } });
  });

  it('uses an assigned channel in manual prompts, merges its hashtags on import, and tolerates a missing channel', async () => {
    const project = await projectWithChapter();
    const channel = await createChannel({
      name: 'Kênh thử nghiệm',
      defaultHashtags: ['#ChannelOne', '#ChannelTwo'],
      links: [{ label: 'Private link', url: 'https://example.org/private' }],
      descriptionFooter: 'Private footer.',
      aiDisclosureText: 'Private disclosure.',
    });
    await setProjectChannel(project.id, channel.id);
    const base = await startSeoServer();
    const promptResponse = await fetch(`${base}/api/project/${project.id}/seo/manual-prompt?sections=tags`);
    const promptBody = await promptResponse.json() as { prompt: string };

    expect(promptResponse.status).toBe(200);
    expect(promptBody.prompt).toContain('Channel:\nName: Kênh thử nghiệm');
    expect(promptBody.prompt).toContain('Default hashtags: ["#ChannelOne","#ChannelTwo"]');
    expect(promptBody.prompt).not.toContain('Private link');
    expect(promptBody.prompt).not.toContain('Private footer.');
    expect(promptBody.prompt).not.toContain('Private disclosure.');

    const imported = await fetch(`${base}/api/project/${project.id}/seo/manual-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw: seoRaw, sections: ['tags'] }),
    });
    expect(imported.status).toBe(200);
    expect((await imported.json()).seo.hashtags).toEqual(['#ChannelOne', '#ChannelTwo']);

    const missing = await projectWithChapter();
    await setProjectChannel(missing.id, 'missing-channel');
    const missingPrompt = await fetch(`${base}/api/project/${missing.id}/seo/manual-prompt?sections=tags`);
    expect(missingPrompt.status).toBe(200);
    expect((await missingPrompt.json()).prompt).not.toContain('Channel:');
  });

  it('rejects unknown body fields and unknown section values', async () => {
    const project = await projectWithChapter();
    const base = await startSeoServer();
    const extra = await fetch(`${base}/api/project/${project.id}/seo/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extra: true }) });
    expect(extra.status).toBe(400);
    const unknownSection = await fetch(`${base}/api/project/${project.id}/seo/manual-import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: seoRaw, sections: ['unknown'] }) });
    expect(unknownSection.status).toBe(400);
    const unknownPatch = await fetch(`${base}/api/project/${project.id}/seo`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extra: true }) });
    expect(unknownPatch.status).toBe(400);
  });

  it('uploads, replaces, and deletes a JPEG/PNG thumbnail with a MIME-derived extension', async () => {
    const project = await projectWithChapter();
    const base = await startSeoServer();
    const form = (type: string, name: string, bytes = 'image') => {
      const value = new FormData();
      value.append('file', new Blob([Buffer.from(bytes)], { type }), name);
      return value;
    };

    const firstResponse = await fetch(`${base}/api/project/${project.id}/seo/thumbnail`, { method: 'PUT', body: form('image/png', 'not-really.png.exe') });
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as { seo: { thumbnail: { fileId: string } } };
    const store = createFileStoreService(filesDir);
    const firstFile = (await store.listProjectFiles(project.id)).find((file) => file.id === first.seo.thumbnail.fileId);
    expect(firstFile).toMatchObject({ purpose: 'thumbnail', mimeType: 'image/png', ext: 'png' });

    const secondResponse = await fetch(`${base}/api/project/${project.id}/seo/thumbnail`, { method: 'PUT', body: form('image/jpeg', 'thumbnail.jpg') });
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json() as { seo: { thumbnail: { fileId: string } } };
    expect(second.seo.thumbnail.fileId).not.toBe(first.seo.thumbnail.fileId);
    expect((await store.listProjectFiles(project.id)).filter((file) => file.purpose === 'thumbnail')).toHaveLength(1);

    const removed = await fetch(`${base}/api/project/${project.id}/seo/thumbnail`, { method: 'DELETE' });
    expect((await removed.json()).seo.thumbnail.fileId).toBeNull();
    expect((await store.listProjectFiles(project.id)).filter((file) => file.purpose === 'thumbnail')).toHaveLength(0);
    expect((await fetch(`${base}/api/project/${project.id}/seo/thumbnail`, { method: 'DELETE' })).status).toBe(200);
  });

  it('rejects non-image and oversized thumbnail uploads', async () => {
    const project = await projectWithChapter();
    const base = await startSeoServer();
    const pdf = new FormData();
    pdf.append('file', new Blob([Buffer.from('pdf')], { type: 'application/pdf' }), 'thumbnail.pdf');
    const invalid = await fetch(`${base}/api/project/${project.id}/seo/thumbnail`, { method: 'PUT', body: pdf });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'INVALID_FILE_TYPE' } });

    const large = new FormData();
    large.append('file', new Blob([Buffer.alloc(2 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
    const tooLarge = await fetch(`${base}/api/project/${project.id}/seo/thumbnail`, { method: 'PUT', body: large });
    expect(tooLarge.status).toBe(400);
    expect(await tooLarge.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });
  }, 30_000);

  it('deletes the project thumbnail file through the project delete hook', async () => {
    const project = await projectWithChapter();
    const { createApp } = await import('../../app');
    const productionApp = createApp({ filesDir, clientDir: null });
    await new Promise<void>((resolve) => { server = productionApp.listen(0, () => resolve()); });
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('png')], { type: 'image/png' }), 'thumbnail.png');
    await fetch(`${base}/api/project/${project.id}/seo/thumbnail`, { method: 'PUT', body: form });
    const before = await getProject(project.id);
    expect(before.seo.thumbnail.fileId).toBeTruthy();
    const deleted = await fetch(`${base}/api/project/${project.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    expect((await createFileStoreService(filesDir).listProjectFiles(project.id)).filter((file) => file.purpose === 'thumbnail')).toHaveLength(0);
  });
});
