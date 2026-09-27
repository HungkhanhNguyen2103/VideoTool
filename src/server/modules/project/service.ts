import type { AiProvider, CreateProjectRequest, ListProjectsQuery, ProjectDetail, ProjectStatus, ProjectSummary, VisualStyleId, WordTimings } from '../../../contracts/project';
import type { ChapterDoc, ChapterSnapshot, HubrisMotif, OpenLoop } from '../../../contracts/script';
import type { z } from 'zod';
import { NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { getCollection } from '../../db/client';
import { ProjectDocSchema, SceneDocSchema, type ProjectDoc, type SceneDoc } from './docs';
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
    visualStylePresetId: doc.visualStylePresetId,
    targetDurationSec: doc.targetDurationSec,
    chapterCount: doc.chapterCount,
    voiceId: doc.voiceId,
    aiProvider: doc.aiProvider,
    renderEngine: doc.renderEngine,
    keywordPopupsEnabled: doc.keywordPopupsEnabled,
    voiceoverVoice: doc.voiceoverVoice,
    renderFileId: doc.renderFileId,
    bgmMood: doc.bgmMood,
    bgmFileId: doc.bgmFileId,
    customStyleReferenceFileId: doc.customStyleReferenceFileId,
    renderSettings: doc.renderSettings,
    scenes: doc.scenes,
    chapters: doc.chapters,
    openLoops: doc.openLoops,
    motif: doc.motif,
    coreQuestion: doc.coreQuestion,
    openingHook: doc.openingHook,
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
    visualStylePresetId: input.visualStylePresetId ?? 'cinematic',
    targetDurationSec: input.targetDurationSec,
    chapterCount: input.chapterCount,
    voiceId: input.voiceId,
    aiProvider: input.aiProvider ?? 'deepseek',
    renderEngine: input.renderEngine ?? 'ffmpeg',
    keywordPopupsEnabled: true,
    voiceoverVoice: input.voiceoverVoice ?? 'Truc Ly',
    renderFileId: input.renderFileId ?? null,
    bgmMood: input.bgmMood ?? '',
    bgmFileId: input.bgmFileId ?? null,
    customStyleReferenceFileId: null,
    renderSettings: input.renderSettings,
    status: 'draft',
    scenes: [],
    chapters: [],
    openLoops: [],
    motif: null,
    coreQuestion: '',
    openingHook: '',
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
    // A duplicate does not copy files; clear references so scenes cannot point
    // at metadata and disk content owned by the source project.
    scenes: src.scenes.map((scene) => ({ ...scene, assetFileId: null, audioFileId: null, wordTimings: null, sfxFileId: null })),
    renderFileId: null,
    bgmFileId: null,
    customStyleReferenceFileId: null,
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

export async function replaceProjectScenes(id: string, scenes: z.input<typeof SceneDocSchema>[], newStatus?: ProjectStatus): Promise<void> {
  const previous = await getProject(id);
  const oldById = new Map(previous.scenes.map((scene) => [scene.id, scene]));
  const safeScenes = scenes.map((scene) => {
    const old = oldById.get(scene.id);
    const sameVoice = old && old.narration === scene.narration && old.audioFileId === scene.audioFileId;
    return SceneDocSchema.parse({ ...scene, wordTimings: sameVoice && old.wordTimings?.audioFileId === scene.audioFileId ? old.wordTimings : null });
  });
  await updateProject(id, { scenes: safeScenes, ...(newStatus ? { status: newStatus } : {}) });
}

export async function patchProjectScene(
  id: string,
  sceneId: string,
  patch: Partial<Pick<SceneDoc, 'visualPrompt' | 'assetType' | 'assetFileId' | 'audioFileId' | 'durationSec' | 'sfxPrompt' | 'sfxFileId'>>,
): Promise<ProjectDetail> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [field, value] of Object.entries(patch)) set[`scenes.$[scene].${field}`] = value;
  if (patch.audioFileId !== undefined) set['scenes.$[scene].wordTimings'] = null;
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

export async function setProjectBgm(id: string, mood: string, bgmFileId: string | null): Promise<ProjectDetail> {
  await updateProject(id, { bgmMood: mood, bgmFileId });
  return getProject(id);
}

export type ProjectStyleReferenceCandidate = {
  projectId: string;
  visualStylePresetId: VisualStyleId;
  fileId: string;
};

export async function listProjectStyleReferenceCandidates(): Promise<ProjectStyleReferenceCandidate[]> {
  const docs = await getCollection<ProjectDoc>('projects').find({ customStyleReferenceFileId: { $type: 'string' } }).toArray();
  return docs.map((raw) => ProjectDocSchema.parse(raw)).flatMap((project) => project.customStyleReferenceFileId
    ? [{ projectId: project._id, visualStylePresetId: project.visualStylePresetId, fileId: project.customStyleReferenceFileId }]
    : []);
}

/** Commit only while both the voiceover and narration still equal the aligned snapshot. */
export async function setSceneWordTimings(
  projectId: string, sceneId: string, expectedAudioFileId: string, expectedNarration: string, timings: WordTimings | null,
): Promise<boolean> {
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: projectId, scenes: { $elemMatch: { id: sceneId, audioFileId: expectedAudioFileId, narration: expectedNarration } } },
    { $set: { 'scenes.$.wordTimings': timings, updatedAt: new Date() }, $inc: { version: 1 } },
  );
  return result.matchedCount > 0;
}

export async function setProjectCustomStyleReferenceFile(id: string, fileId: string | null): Promise<ProjectDetail> {
  await updateProject(id, { customStyleReferenceFileId: fileId });
  return getProject(id);
}

export async function setProjectRenderFile(id: string, renderFileId: string): Promise<ProjectDetail> {
  await updateProject(id, { renderFileId, status: 'rendered' });
  return getProject(id);
}

export async function setProjectRenderEngine(id: string, renderEngine: ProjectDetail['renderEngine']): Promise<ProjectDetail> {
  await updateProject(id, { renderEngine });
  return getProject(id);
}

export async function setProjectKeywordPopups(id: string, enabled: boolean): Promise<ProjectDetail> {
  await updateProject(id, { keywordPopupsEnabled: enabled });
  return getProject(id);
}

export async function setProjectAiProvider(id: string, aiProvider: AiProvider): Promise<ProjectDetail> {
  await updateProject(id, { aiProvider });
  return getProject(id);
}

export async function setProjectVisualStylePreset(id: string, visualStylePresetId: VisualStyleId): Promise<ProjectDetail> {
  await updateProject(id, { visualStylePresetId });
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

type EmptyScenePromptUpdate = {
  sceneId: string;
  visualPrompt?: string;
  sfxPrompt?: string;
};

type EmptyScenePromptWriteResult = {
  project: ProjectDetail;
  updatedSceneIds: string[];
  updatedSfxPromptSceneIds: string[];
};

function hasPromptValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

export async function applyEmptySceneVisualPrompts(
  projectId: string,
  updates: EmptyScenePromptUpdate[],
): Promise<ProjectDetail> {
  return (await applyEmptySceneVisualPromptsWithResult(projectId, updates)).project;
}

export async function applyEmptySceneVisualPromptsWithResult(
  projectId: string,
  updates: EmptyScenePromptUpdate[],
): Promise<EmptyScenePromptWriteResult> {
  const project = await getProject(projectId);
  const latest = new Map<string, { visualPrompt?: string; sfxPrompt?: string }>();
  for (const update of updates) {
    const current = latest.get(update.sceneId) ?? {};
    if (update.visualPrompt !== undefined) current.visualPrompt = update.visualPrompt;
    if (update.sfxPrompt !== undefined) current.sfxPrompt = update.sfxPrompt;
    latest.set(update.sceneId, current);
  }
  if (latest.size === 0) return { project, updatedSceneIds: [], updatedSfxPromptSceneIds: [] };

  const scenesById = new Map(project.scenes.map((scene) => [scene.id, scene]));
  for (const sceneId of latest.keys()) {
    if (!scenesById.has(sceneId)) throw new NotFound('Không tìm thấy cảnh.');
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const arrayFilters: Record<string, unknown>[] = [];
  const eligibleClauses: Record<string, unknown>[] = [];
  for (const [index, [sceneId, update]] of [...latest].entries()) {
    if (hasPromptValue(update.visualPrompt)) {
      const identifier = `visual${index}`;
      set[`scenes.$[${identifier}].visualPrompt`] = update.visualPrompt;
      arrayFilters.push({ [`${identifier}.id`]: sceneId, [`${identifier}.visualPrompt`]: '' });
      eligibleClauses.push({ id: sceneId, visualPrompt: '' });
    }
    if (hasPromptValue(update.sfxPrompt)) {
      const identifier = `sfx${index}`;
      set[`scenes.$[${identifier}].sfxPrompt`] = update.sfxPrompt;
      arrayFilters.push({ [`${identifier}.id`]: sceneId, [`${identifier}.sfxPrompt`]: '' });
      eligibleClauses.push({ id: sceneId, sfxPrompt: '' });
    }
  }
  if (eligibleClauses.length === 0) return { project, updatedSceneIds: [], updatedSfxPromptSceneIds: [] };

  const previous = await getCollection<ProjectDoc>('projects').findOneAndUpdate(
    { _id: projectId, scenes: { $elemMatch: { $or: eligibleClauses } } },
    { $set: set, $inc: { version: 1 } },
    { arrayFilters, returnDocument: 'before' },
  );
  const updatedSceneIds = previous
    ? [...latest].filter(([sceneId, update]) => hasPromptValue(update.visualPrompt) && previous.scenes.some((scene) => scene.id === sceneId && scene.visualPrompt === '')).map(([sceneId]) => sceneId)
    : [];
  const updatedSfxPromptSceneIds = previous
    ? [...latest].filter(([sceneId, update]) => hasPromptValue(update.sfxPrompt) && previous.scenes.some((scene) => scene.id === sceneId && scene.sfxPrompt === '')).map(([sceneId]) => sceneId)
    : [];
  return { project: await getProject(projectId), updatedSceneIds, updatedSfxPromptSceneIds };
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

export async function replaceProjectScript(
  id: string,
  chapters: ChapterDoc[],
  openLoops: OpenLoop[],
  motif: HubrisMotif | null,
  coreQuestion: string = '',
  openingHook: string = '',
  snapshot: ChapterSnapshot | null = null,
  newStatus?: ProjectStatus,
): Promise<ProjectDetail> {
  await updateProject(id, { chapters, openLoops, motif, coreQuestion, openingHook, ...(newStatus ? { status: newStatus } : {}) }, snapshot);
  return getProject(id);
}

export async function patchProjectChapter(
  id: string,
  chapterId: string,
  patch: Partial<Pick<ChapterDoc, 'paragraphs' | 'status' | 'title' | 'chapterSummary' | 'avoidRepeating' | 'persistentFacts' | 'reviewStatus'>>,
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
