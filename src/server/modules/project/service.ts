import type { CreateProjectRequest, ListProjectsQuery, ProjectDetail, ProjectStatus, ProjectSummary } from '../../../contracts/project';
import type { ChapterDoc, ChapterSnapshot } from '../../../contracts/script';
import { NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { getCollection } from '../../db/client';
import type { ProjectDoc, SceneDoc } from './docs';
import { deleteProjectById, findProjectById, insertProject, listProjectSummaries, type ProjectSummaryRow } from './repo';
import { normalizeTitle } from './title-search';

function toSummary(row: ProjectSummaryRow): ProjectSummary {
  return {
    id: row._id,
    title: row.title,
    status: row.status,
    scenesCount: row.scenesCount,
    durationSec: row.durationSec,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(doc: ProjectDoc): ProjectDetail {
  return {
    id: doc._id,
    title: doc.title,
    status: doc.status,
    language: doc.language,
    brief: doc.brief,
    referencesText: doc.referencesText,
    scriptPresetId: doc.scriptPresetId,
    targetDurationSec: doc.targetDurationSec,
    chapterCount: doc.chapterCount,
    voiceId: doc.voiceId,
    aiProvider: doc.aiProvider,
    renderSettings: doc.renderSettings,
    scenes: doc.scenes,
    chapters: doc.chapters,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function createProject(input: CreateProjectRequest): Promise<ProjectDetail> {
  const now = new Date();
  const doc: ProjectDoc = {
    _id: newId(),
    schemaVersion: 1,
    title: input.title,
    titleSearch: normalizeTitle(input.title),
    language: input.language,
    brief: input.brief,
    referencesText: input.referencesText,
    scriptPresetId: input.scriptPresetId,
    targetDurationSec: input.targetDurationSec,
    chapterCount: input.chapterCount,
    voiceId: input.voiceId,
    aiProvider: input.aiProvider ?? 'deepseek',
    renderSettings: input.renderSettings,
    status: 'draft',
    scenes: [],
    chapters: [],
    chapterHistory: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await insertProject(doc);
  return toDetail(doc);
}

export async function listProjects(query: ListProjectsQuery): Promise<ProjectSummary[]> {
  const rows = await listProjectSummaries(query);
  return rows.map(toSummary);
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const doc = await findProjectById(id);
  if (!doc) throw new NotFound('Không tìm thấy dự án.');
  return toDetail(doc);
}

/** New id, title gets " (bản sao)", version resets to 1. A copy has no video file yet. */
export async function duplicateProject(id: string): Promise<ProjectDetail> {
  const src = await findProjectById(id);
  if (!src) throw new NotFound('Không tìm thấy dự án.');
  const now = new Date();
  const title = `${src.title} (bản sao)`;
  const doc: ProjectDoc = {
    ...src,
    _id: newId(),
    title,
    titleSearch: normalizeTitle(title),
    status: src.status === 'rendered' ? 'assets' : src.status,
    scenes: src.scenes.map((scene) => ({ ...scene })),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await insertProject(doc);
  return toDetail(doc);
}

export async function deleteProject(id: string): Promise<void> {
  // TODO(phase-4): also delete assets/renders/files under data/files/<projectId>/
  const deletedCount = await deleteProjectById(id);
  if (deletedCount === 0) throw new NotFound('Không tìm thấy dự án.');
}

export async function replaceProjectScenes(id: string, scenes: SceneDoc[], newStatus?: ProjectStatus): Promise<void> {
  await updateProject(id, { scenes, ...(newStatus ? { status: newStatus } : {}) });
}

export async function patchProjectScene(
  id: string,
  sceneId: string,
  patch: Partial<Pick<SceneDoc, 'visualPrompt' | 'assetType' | 'assetFileId'>>,
): Promise<ProjectDetail> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [field, value] of Object.entries(patch)) set[`scenes.$[scene].${field}`] = value;
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id, scenes: { $elemMatch: { id: sceneId } } },
    { $set: set, $inc: { version: 1 } },
    { arrayFilters: [{ 'scene.id': sceneId }] },
  );
  if (result.matchedCount === 0) throw new NotFound('Không tìm thấy cảnh.');
  return getProject(id);
}

export async function setProjectScenesAssetType(id: string, assetType: 'image' | 'video'): Promise<ProjectDetail> {
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id },
    { $set: { 'scenes.$[].assetType': assetType, updatedAt: new Date() }, $inc: { version: 1 } },
  );
  if (result.matchedCount === 0) throw new NotFound('Không tìm thấy dự án.');
  return getProject(id);
}

export async function applySceneAssets(
  id: string,
  assetUpdates: Array<{ sceneId: string; assetFileId: string }>,
): Promise<ProjectDetail> {
  const project = await getProject(id);
  const latest = new Map<string, string>();
  for (const update of assetUpdates) latest.set(update.sceneId, update.assetFileId);
  if (latest.size === 0) return project;
  for (const sceneId of latest.keys()) {
    if (!project.scenes.some((scene) => scene.id === sceneId)) throw new NotFound('Không tìm thấy cảnh.');
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const arrayFilters: Record<string, unknown>[] = [];
  let index = 0;
  for (const [sceneId, assetFileId] of latest) {
    const identifier = `scene${index}`;
    set[`scenes.$[${identifier}].assetFileId`] = assetFileId;
    arrayFilters.push({ [`${identifier}.id`]: sceneId });
    index += 1;
  }
  await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id },
    { $set: set, $inc: { version: 1 } },
    { arrayFilters },
  );
  return getProject(id);
}

export async function replaceProjectChapters(
  id: string,
  chapters: ChapterDoc[],
  snapshot: ChapterSnapshot | null,
  newStatus?: ProjectStatus,
): Promise<ProjectDetail> {
  await updateProject(id, { chapters, ...(newStatus ? { status: newStatus } : {}) }, snapshot);
  return getProject(id);
}

export async function patchProjectChapter(
  id: string,
  chapterId: string,
  patch: Partial<Pick<ChapterDoc, 'paragraphs' | 'status' | 'title'>>,
  snapshot: ChapterSnapshot | null = null,
): Promise<ProjectDetail> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [field, value] of Object.entries(patch)) set[`chapters.$[elem].${field}`] = value;
  const update: Record<string, unknown> = { $set: set };
  if (snapshot) update.$push = { chapterHistory: { $each: [snapshot], $position: 0, $slice: 10 } };
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id },
    { ...update, $inc: { version: 1 } },
    { arrayFilters: [{ 'elem.id': chapterId }] },
  );
  if (result.matchedCount === 0 || result.modifiedCount === 0) throw new NotFound('Không tìm thấy chương.');
  return getProject(id);
}

export async function restoreProjectChapters(id: string, chapters: ChapterDoc[], snapshot: ChapterSnapshot): Promise<ProjectDetail> {
  await updateProject(id, { chapters }, snapshot);
  return getProject(id);
}

export async function getProjectHistory(id: string): Promise<ChapterSnapshot[]> {
  const project = await findProjectById(id);
  if (!project) throw new NotFound('Không tìm thấy dự án.');
  return project.chapterHistory;
}

async function updateProject(id: string, fields: Record<string, unknown>, snapshot: ChapterSnapshot | null = null): Promise<void> {
  const $set = { ...fields, updatedAt: new Date() };
  const update: Record<string, unknown> = { $set, $inc: { version: 1 } };
  if (snapshot) update.$push = { chapterHistory: { $each: [snapshot], $position: 0, $slice: 10 } };
  const result = await getCollection<ProjectDoc>('projects').updateOne({ _id: id }, update as never);
  if (result.matchedCount === 0) throw new NotFound('Không tìm thấy dự án.');
}
