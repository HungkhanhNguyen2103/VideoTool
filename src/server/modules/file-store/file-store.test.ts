import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getCollection } from '../../db/client';
import { closeTestMongo, resetTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { FileDocSchema } from './docs';
import { deleteFileById, findFileById, insertFile, listFilesByProjectId } from './repo';
import { newId } from '../../shared/ids';
import type { FileDoc } from './docs';
import { createFileStoreService } from './service';
import { NotFound } from '../../shared/errors';
import { createApp } from '../../app';
import { createProject, setProjectDraftRenderFile, setProjectLogo, setProjectRenderFile } from '../project/service';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import AdmZip from 'adm-zip';
import { ProjectDocSchema } from '../project/docs';

let filesDir: string;
let service: ReturnType<typeof createFileStoreService>;
let server: Server | null = null;
const tempDirs: string[] = [];

const projectInput = {
  title: 'File test project',
  brief: 'A valid brief for file upload tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: null,
  voiceId: null,
  aiProvider: 'deepseek' as const,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

function makeFile(overrides: Partial<FileDoc> = {}): FileDoc {
  return {
    _id: newId(),
    projectId: 'project-1',
    originalName: 'reference.png',
    mimeType: 'image/png',
    ext: 'png',
    sizeBytes: 3,
    purpose: 'reference',
    storedPath: 'stored.png',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('file-store schema and repository', () => {
  beforeAll(async () => startTestMongo());
  beforeEach(async () => {
    await resetTestMongo();
    await getCollection<FileDoc>('files').deleteMany({});
    filesDir = mkdtempSync(path.join(tmpdir(), 'video-tool-files-'));
    tempDirs.push(filesDir);
    service = createFileStoreService(filesDir);
  });
  afterAll(async () => { await closeTestMongo(); for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }); });

  async function startServer(): Promise<string> {
    const app = createApp({ filesDir, clientDir: null });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    const current = server;
    server = null;
    if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
  });

  it('validates the persisted file document', () => {
    expect(FileDocSchema.parse(makeFile()).purpose).toBe('reference');
    expect(FileDocSchema.parse({ ...makeFile(), purpose: 'voiceover' }).purpose).toBe('voiceover');
    expect(FileDocSchema.parse({ ...makeFile(), purpose: 'style-reference' }).purpose).toBe('style-reference');
    expect(FileDocSchema.parse({ ...makeFile(), purpose: 'logo' }).purpose).toBe('logo');
    expect(FileDocSchema.parse({ ...makeFile(), purpose: 'render-draft' }).purpose).toBe('render-draft');
  });

  it('normalizes legacy project audio, render, and style-reference fields through schema defaults', () => {
    const legacy = {
      _id: 'project-1', schemaVersion: 1, title: 'Legacy', titleSearch: 'legacy', language: 'vi', brief: 'A legacy project',
      referencesText: '', scriptPresetId: 'documentary', targetDurationSec: 60, chapterCount: null, voiceId: null,
      renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, status: 'assets',
      scenes: [{ id: 'scene-1', narration: 'Hello', visualPrompt: '', durationSec: 5 }], chapters: [], chapterHistory: [], version: 1,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const parsed = ProjectDocSchema.parse(legacy);
    expect(parsed).toMatchObject({ renderEngine: 'ffmpeg', voiceoverVoice: 'Truc Ly', renderFileId: null, bgmMood: '', bgmFileId: null, logoFileId: null, customStyleReferenceFileId: null });
    expect(parsed.scenes[0]).toMatchObject({ audioFileId: null, sfxPrompt: '', motionPrompt: '', sfxFileId: null });
  });

  it('inserts, finds, deletes, and lists files by project', async () => {
    const first = makeFile({ projectId: 'project-1' });
    const second = makeFile({ projectId: 'project-2' });
    await insertFile(first);
    await insertFile(second);
    expect(await findFileById(first._id)).toMatchObject({ projectId: 'project-1' });
    expect(await listFilesByProjectId('project-1')).toHaveLength(1);
    await deleteFileById(first._id);
    expect(await findFileById(first._id)).toBeNull();
  });

  it('writes a generated safe path and returns a file summary', async () => {
    const summary = await service.storeFile({ projectId: 'project-1', originalName: '../secret.png', mimeType: 'image/png', buffer: Buffer.from('png'), purpose: 'reference' });
    expect(summary).toMatchObject({ projectId: 'project-1', originalName: '../secret.png', ext: 'png', sizeBytes: 3, purpose: 'reference', storedPath: expect.stringMatching(/\.png$/) });
    expect(summary.createdAt).toEqual(expect.any(String));
    expect(summary.id).toMatch(/^[0-9A-Z]{26}$/);
    const doc = await findFileById(summary.id);
    expect(doc?.storedPath).toMatch(/^[0-9A-Z]{26}\.png$/);
    expect(readFileSync(path.join(filesDir, doc!.storedPath))).toEqual(Buffer.from('png'));
  });

  it('stores a render draft purpose for generated preview files', async () => {
    const summary = await service.storeFile({ projectId: 'project-1', originalName: 'render-draft.mp4', mimeType: 'video/mp4', buffer: Buffer.from('draft'), purpose: 'render-draft' });
    expect(summary).toMatchObject({ purpose: 'render-draft', originalName: 'render-draft.mp4', mimeType: 'video/mp4' });
  });

  it('deletes final, draft, and logo files when deleting a project', async () => {
    const project = await createProject(projectInput);
    const finalFile = await service.storeFile({ projectId: project.id, originalName: 'render.mp4', mimeType: 'video/mp4', buffer: Buffer.from('final'), purpose: 'render' });
    const draftFile = await service.storeFile({ projectId: project.id, originalName: 'render-draft.mp4', mimeType: 'video/mp4', buffer: Buffer.from('draft'), purpose: 'render-draft' });
    const logoFile = await service.storeFile({ projectId: project.id, originalName: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('logo'), purpose: 'logo' });
    await setProjectRenderFile(project.id, finalFile.id);
    await setProjectDraftRenderFile(project.id, draftFile.id);
    await setProjectLogo(project.id, logoFile.id);
    const finalPath = path.join(filesDir, finalFile.storedPath);
    const draftPath = path.join(filesDir, draftFile.storedPath);
    const logoPath = path.join(filesDir, logoFile.storedPath);
    const base = await startServer();

    const response = await fetch(`${base}/api/project/${project.id}`, { method: 'DELETE' });

    expect(response.status).toBe(204);
    expect(await findFileById(finalFile.id)).toBeNull();
    expect(await findFileById(draftFile.id)).toBeNull();
    expect(await findFileById(logoFile.id)).toBeNull();
    expect(existsSync(finalPath)).toBe(false);
    expect(existsSync(draftPath)).toBe(false);
    expect(existsSync(logoPath)).toBe(false);
  });

  it('stores audio purposes and resolves only files owned by the requested project', async () => {
    const first = await service.storeFile({ projectId: 'project-1', originalName: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from('wav'), purpose: 'voiceover' });
    expect(first.purpose).toBe('voiceover');
    await expect(service.resolveFilePath('project-1', first.id)).resolves.toMatchObject({ mimeType: 'audio/wav', purpose: 'voiceover', absolutePath: path.join(filesDir, first.storedPath) });
    await expect(service.resolveFilePath('project-2', first.id)).rejects.toBeInstanceOf(NotFound);
  });

  it('derives an extension from MIME when the original name has none', async () => {
    const summary = await service.storeFile({ projectId: 'project-1', originalName: 'README', mimeType: 'application/pdf', buffer: Buffer.from('pdf'), purpose: 'reference' });
    expect(summary.ext).toBe('pdf');
  });

  it('deletes metadata even when the disk file is already gone', async () => {
    const summary = await service.storeFile({ projectId: 'project-1', originalName: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x'), purpose: 'reference' });
    const doc = await findFileById(summary.id);
    unlinkSync(path.join(filesDir, doc!.storedPath));
    await expect(service.deleteFile(summary.id)).resolves.toBeUndefined();
    await expect(service.deleteFile(summary.id)).rejects.toBeInstanceOf(NotFound);
  });

  it('lists only files for the requested project', async () => {
    await service.storeFile({ projectId: 'project-1', originalName: 'a.png', mimeType: 'image/png', buffer: Buffer.from('a'), purpose: 'reference' });
    await service.storeFile({ projectId: 'project-2', originalName: 'b.png', mimeType: 'image/png', buffer: Buffer.from('b'), purpose: 'reference' });
    expect(await service.listProjectFiles('project-1')).toHaveLength(1);
  });

  it('throws NotFound for an unknown file id', async () => {
    await expect(service.deleteFile('missing')).rejects.toBeInstanceOf(NotFound);
  });

  it('uploads a valid PNG through the project route', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('png')], { type: 'image/png' }), 'reference.png');
    const response = await fetch(`${base}/api/project/${project.id}/files`, { method: 'POST', body: form });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ projectId: project.id, mimeType: 'image/png', ext: 'png' });
  });

  it('stores a requested style reference purpose and rejects a non-image style reference', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();
    const styleForm = new FormData();
    styleForm.append('file', new Blob([Buffer.from('png')], { type: 'image/png' }), 'style.png');
    styleForm.append('purpose', 'style-reference');
    const styleResponse = await fetch(`${base}/api/project/${project.id}/files`, { method: 'POST', body: styleForm });
    expect(styleResponse.status).toBe(201);
    expect(await styleResponse.json()).toMatchObject({ purpose: 'style-reference', mimeType: 'image/png' });

    const invalidForm = new FormData();
    invalidForm.append('file', new Blob([Buffer.from('pdf')], { type: 'application/pdf' }), 'style.pdf');
    invalidForm.append('purpose', 'style-reference');
    const invalidResponse = await fetch(`${base}/api/project/${project.id}/files`, { method: 'POST', body: invalidForm });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({ error: { code: 'INVALID_FILE_TYPE' } });

    const logoForm = new FormData();
    logoForm.append('file', new Blob([Buffer.from('png')], { type: 'image/png' }), 'logo.png');
    logoForm.append('purpose', 'logo');
    const logoUploadResponse = await fetch(`${base}/api/project/${project.id}/files`, { method: 'POST', body: logoForm });
    expect(logoUploadResponse.status).toBe(201);
    expect(await logoUploadResponse.json()).toMatchObject({ purpose: 'logo', mimeType: 'image/png' });

    const logoPdf = new FormData();
    logoPdf.append('file', new Blob([Buffer.from('pdf')], { type: 'application/pdf' }), 'logo.pdf');
    logoPdf.append('purpose', 'logo');
    const logoResponse = await fetch(`${base}/api/project/${project.id}/files`, { method: 'POST', body: logoPdf });
    expect(logoResponse.status).toBe(400);
    expect(await logoResponse.json()).toMatchObject({ error: { code: 'INVALID_FILE_TYPE' } });
  });

  it('rejects a disallowed upload MIME type', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('text')], { type: 'text/plain' }), 'notes.txt');
    const response = await fetch(`${base}/api/project/${project.id}/files`, { method: 'POST', body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_FILE_TYPE' } });
  });

  it('maps an oversized upload to FILE_TOO_LARGE', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(100 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
    const response = await fetch(`${base}/api/project/${project.id}/files`, { method: 'POST', body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });
  }, 30_000);

  it('prevents deleting a file through a different project', async () => {
    const first = await createProject(projectInput);
    const second = await createProject({ ...projectInput, title: 'Second file project' });
    const stored = await service.storeFile({ projectId: first.id, originalName: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x'), purpose: 'reference' });
    const base = await startServer();
    const response = await fetch(`${base}/api/project/${second.id}/files/${stored.id}`, { method: 'DELETE' });
    expect(response.status).toBe(404);
  });

  function zipWith(entries: Record<string, string>): Buffer {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content));
    return zip.toBuffer();
  }

  it('imports a partial project seed and ordered reference documents without creating a project', async () => {
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(zipWith({
      'project.json': JSON.stringify({ title: 'Seed', referencesText: 'From JSON' }),
      'references/z-last.txt': 'Last',
      'references/a-first.md': 'First',
    }))], { type: 'application/zip' }), 'seed.zip');
    const response = await fetch(`${base}/api/project/import-seed`, { method: 'POST', body: form });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: 'Seed', referencesText: 'From JSON\n\nFirst\n\nLast' });
  });

  it('rejects a missing or invalid project seed with 400', async () => {
    const base = await startServer();
    const missing = new FormData();
    missing.append('file', new Blob([new Uint8Array(zipWith({}))], { type: 'application/zip' }), 'seed.zip');
    const missingResponse = await fetch(`${base}/api/project/import-seed`, { method: 'POST', body: missing });
    expect(missingResponse.status).toBe(400);
    const invalid = new FormData();
    invalid.append('file', new Blob([new Uint8Array(zipWith({ 'project.json': '{"unknown":true}' }))], { type: 'application/zip' }), 'seed.zip');
    const invalidResponse = await fetch(`${base}/api/project/import-seed`, { method: 'POST', body: invalid });
    expect(invalidResponse.status).toBe(400);
  });

  it('rejects a non-ZIP seed upload', async () => {
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob(['not zip'], { type: 'text/plain' }), 'seed.txt');
    const response = await fetch(`${base}/api/project/import-seed`, { method: 'POST', body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_FILE_TYPE' } });
  });

  it('extracts plain reference text through the upload endpoint', async () => {
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob(['Hello from markdown'], { type: 'text/markdown' }), 'notes.md');
    const response = await fetch(`${base}/api/project/reference-text`, { method: 'POST', body: form });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'Hello from markdown' });
  });

  it('imports root scenes.json and replaces project scenes', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();
    const scenes = [{ id: 'scene-1', narration: 'Hello', visualPrompt: 'A room', durationSec: 5 }];
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(zipWith({ 'scenes.json': JSON.stringify(scenes) }))], { type: 'application/zip' }), 'scenes.zip');
    const response = await fetch(`${base}/api/project/${project.id}/import-zip`, { method: 'POST', body: form });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: project.id, scenes, version: 2 });
  });

  it('rejects a ZIP without root scenes.json with 422', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(zipWith({ 'nested/scenes.json': '[]' }))], { type: 'application/zip' }), 'scenes.zip');
    const response = await fetch(`${base}/api/project/${project.id}/import-zip`, { method: 'POST', body: form });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'MISSING_SCENES_JSON' } });
  });

  it('rejects invalid scenes.json with 422 field errors', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(zipWith({ 'scenes.json': JSON.stringify([{ id: 'bad' }]) }))], { type: 'application/zip' }), 'scenes.zip');
    const response = await fetch(`${base}/api/project/${project.id}/import-zip`, { method: 'POST', body: form });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.fields.length).toBeGreaterThan(0);
  });

  it('rejects non-ZIP MIME for import', async () => {
    const project = await createProject(projectInput);
    const base = await startServer();
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('not zip')], { type: 'image/png' }), 'not.zip');
    const response = await fetch(`${base}/api/project/${project.id}/import-zip`, { method: 'POST', body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_FILE_TYPE' } });
  });
});
