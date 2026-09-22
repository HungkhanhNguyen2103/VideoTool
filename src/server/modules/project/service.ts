import type { CreateProjectRequest, ListProjectsQuery, ProjectDetail, ProjectSummary } from '../../../contracts/project';
import { NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import type { ProjectDoc } from './docs';
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
    renderSettings: doc.renderSettings,
    scenes: doc.scenes,
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
    renderSettings: input.renderSettings,
    status: 'draft',
    scenes: [],
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
