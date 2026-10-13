import type { AiProvider, CreateProjectRequest, FilmLookStyle, ListProjectsQuery, ParallaxStyle, ProjectDetail, ProjectStatus, ProjectSummary, TransitionStyle, VisualStyleId, WordTimings } from '../../../contracts/project';
import type { PopupPlan } from '../../../contracts/popup-analysis';
import { SeoPackageSchema, SeoPatchSchema, type GeneratedSeoSections, type SeoPatch, type SeoSection } from '../../../contracts/seo';
import { estimateNarrationDurationSec, type ChapterDoc, type ChapterSnapshot, type HubrisMotif, type OpenLoop } from '../../../contracts/script';
import type { z } from 'zod';
import { AppError, Conflict, NotFound } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { getCollection } from '../../db/client';
import { SceneDocSchema, type ProjectDoc, type SceneDoc } from './docs';
import { deleteProjectById, findProjectById, insertProject, listProjectSummaries, type ProjectSummaryRow } from './repo';
import { normalizeTitle } from './title-search';
import { DEFAULT_SCENE_TAIL_SEC, roundDurationSeconds } from '../../../contracts/scene-duration';
import { DEFAULT_VOICE_SPEED, VoiceSpeedSchema } from '../../../contracts/voiceover';
import { getDefaultAiModelId, isAiModelForProvider } from '../../../contracts/ai-models';

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
    aiModel: doc.aiModel,
    renderEngine: doc.renderEngine,
    keywordPopupsEnabled: doc.keywordPopupsEnabled,
    popupDensity: doc.popupDensity,
    transitionStyle: doc.transitionStyle,
    filmLook: doc.filmLook,
    parallax: doc.parallax,
    voiceoverVoice: doc.voiceoverVoice,
    voiceSpeed: doc.voiceSpeed,
    sceneTailSec: doc.sceneTailSec,
    sfxVolume: doc.sfxVolume,
    renderFileId: doc.renderFileId,
    draftRenderFileId: doc.draftRenderFileId,
    bgmMood: doc.bgmMood,
    bgmFileId: doc.bgmFileId,
    logoFileId: doc.logoFileId,
    customStyleReferenceFileId: doc.customStyleReferenceFileId,
    seo: doc.seo,
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
  const aiProvider = input.aiProvider ?? 'deepseek';
  if (input.aiModel !== undefined && !isAiModelForProvider(aiProvider, input.aiModel)) {
    throw new AppError(`Model ${input.aiModel} không còn khả dụng hoặc không thuộc ${aiProvider}; hãy chọn model khác.`, 422, 'AI_MODEL_UNAVAILABLE');
  }
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
    aiProvider,
    ...(input.aiModel === undefined ? {} : { aiModel: input.aiModel }),
    renderEngine: input.renderEngine ?? 'ffmpeg',
    keywordPopupsEnabled: true,
    popupDensity: input.popupDensity ?? 'low',
    transitionStyle: 'varied',
    filmLook: 'auto',
    parallax: 'off',
    voiceoverVoice: input.voiceoverVoice ?? 'Truc Ly',
    voiceSpeed: input.voiceSpeed ?? DEFAULT_VOICE_SPEED,
    sceneTailSec: DEFAULT_SCENE_TAIL_SEC,
    sfxVolume: 0.5,
    renderFileId: input.renderFileId ?? null,
    draftRenderFileId: null,
    bgmMood: input.bgmMood ?? '',
    bgmFileId: input.bgmFileId ?? null,
    logoFileId: null,
    customStyleReferenceFileId: null,
    seo: SeoPackageSchema.parse({}),
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
    scenes: src.scenes.map((scene) => ({ ...scene, assetFileId: null, audioFileId: null, voiceoverDurationSec: null, voiceoverInput: null, wordTimings: null, nameCandidates: null, popupPlan: null, sfxFileId: null, videoKeyframeFileId: null, videoTailFileId: null, videoDurationSec: null, depthMap: null })),
    renderFileId: null,
    draftRenderFileId: null,
    bgmFileId: null,
    logoFileId: null,
    customStyleReferenceFileId: null,
    seo: { ...src.seo, thumbnail: { ...src.seo.thumbnail, fileId: null } },
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
    const parsed = SceneDocSchema.parse({
      ...scene,
      voiceoverDurationSec: scene.audioFileId !== null && sameVoice ? old?.voiceoverDurationSec ?? scene.voiceoverDurationSec ?? null : scene.audioFileId !== null ? scene.voiceoverDurationSec ?? null : null,
      voiceoverInput: scene.audioFileId !== null && sameVoice ? old?.voiceoverInput ?? scene.voiceoverInput ?? null : scene.audioFileId !== null ? scene.voiceoverInput ?? null : null,
      wordTimings: sameVoice && old.wordTimings?.audioFileId === scene.audioFileId ? old.wordTimings : null,
      // Preserve analyzed names as stale history while audio still exists; a bulk reset to no audio clears them.
      nameCandidates: scene.audioFileId !== null ? old?.nameCandidates ?? null : null,
      popupPlan: scene.audioFileId !== null ? old?.popupPlan ?? null : null,
    });
    return {
      ...parsed,
      videoKeyframeFileId: parsed.assetType === 'video' ? parsed.videoKeyframeFileId : null,
      videoTailFileId: parsed.assetType === 'video' ? parsed.videoTailFileId : null,
      videoDurationSec: parsed.assetType === 'video' ? parsed.videoDurationSec : null,
      depthMap: old && parsed.assetType === 'image' && parsed.assetFileId === old.assetFileId ? old.depthMap : null,
    };
  });
  await updateProject(id, { scenes: safeScenes, ...(newStatus ? { status: newStatus } : {}) });
}

export async function patchProjectScene(
  id: string,
  sceneId: string,
  patch: Partial<Pick<SceneDoc, 'narration' | 'visualPrompt' | 'assetType' | 'assetFileId' | 'audioFileId' | 'voiceoverDurationSec' | 'voiceoverInput' | 'durationSec' | 'sfxPrompt' | 'motionPrompt' | 'sfxFileId' | 'videoKeyframeFileId' | 'videoTailFileId' | 'videoDurationSec'>>,
  expectedVersion?: number,
): Promise<ProjectDetail> {
  const current = patch.narration !== undefined || patch.durationSec !== undefined || patch.audioFileId !== undefined ? await getProject(id) : null;
  const currentScene = current?.scenes.find((scene) => scene.id === sceneId);
  if (patch.narration !== undefined && !currentScene) throw new NotFound('Không tìm thấy cảnh.');
  const normalizedNarration = patch.narration?.trim();
  const narrationChanged = patch.narration !== undefined && currentScene !== undefined && normalizedNarration !== currentScene.narration;
  const scenePatch: typeof patch = { ...patch, ...(normalizedNarration !== undefined ? { narration: normalizedNarration } : {}) };
  if (narrationChanged) {
    scenePatch.durationSec = estimateNarrationDurationSec(normalizedNarration!);
    scenePatch.audioFileId = null;
    scenePatch.voiceoverDurationSec = null;
    scenePatch.voiceoverInput = null;
  } else if (patch.audioFileId !== undefined && currentScene && patch.audioFileId !== currentScene.audioFileId && patch.voiceoverDurationSec === undefined) {
    scenePatch.voiceoverDurationSec = null;
    if (patch.voiceoverInput === undefined) scenePatch.voiceoverInput = null;
  } else if (patch.audioFileId === null) {
    scenePatch.voiceoverDurationSec = null;
    scenePatch.voiceoverInput = null;
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [field, value] of Object.entries(scenePatch)) set[`scenes.$[scene].${field}`] = value;
  if (scenePatch.audioFileId !== undefined || narrationChanged) {
    set['scenes.$[scene].wordTimings'] = null;
  }
  if (scenePatch.assetFileId !== undefined || scenePatch.assetType === 'video') set['scenes.$[scene].depthMap'] = null;
  if (scenePatch.assetFileId !== undefined && scenePatch.videoTailFileId === undefined) set['scenes.$[scene].videoTailFileId'] = null;
  if (scenePatch.assetType === 'image') {
    set['scenes.$[scene].videoKeyframeFileId'] = null;
    set['scenes.$[scene].videoTailFileId'] = null;
    set['scenes.$[scene].videoDurationSec'] = null;
  }
  if ((narrationChanged || patch.durationSec !== undefined) && current && currentScene) {
    const sceneIndex = current.scenes.findIndex((scene) => scene.id === sceneId);
    let start = 0;
    for (let chapterIndex = 0; chapterIndex < current.chapters.length; chapterIndex += 1) {
      const chapter = current.chapters[chapterIndex]!;
      const sceneCount = chapter.scenesCount ?? chapter.paragraphs.length;
      if (sceneIndex >= start && sceneIndex < start + sceneCount) {
        const chapterSceneDurations = current.scenes.slice(start, start + sceneCount).map((scene, index) => index === sceneIndex - start ? scenePatch.durationSec ?? scene.durationSec : scene.durationSec);
        set[`chapters.${chapterIndex}.durationSec`] = chapterSceneDurations.reduce((sum, duration) => sum + duration, 0);
        // Finalized chapters have a one-to-one paragraph/scene mapping. A scene-split chapter intentionally does not;
        // in that case the scene duration remains authoritative while the original chapter paragraphs stay intact.
        if (narrationChanged && chapter.paragraphs.length === sceneCount) set[`chapters.${chapterIndex}.paragraphs.${sceneIndex - start}`] = normalizedNarration;
        break;
      }
      start += sceneCount;
    }
  }
  const filter: Record<string, unknown> = { _id: id, scenes: { $elemMatch: { id: sceneId } } };
  if (expectedVersion !== undefined) filter.version = expectedVersion;
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    filter as never,
    { $set: set, $inc: { version: 1 } },
    { arrayFilters: [{ 'scene.id': sceneId }] },
  );
  if (result.matchedCount === 0) {
    if (expectedVersion !== undefined && await findProjectById(id)) throw new AppError('Project changed, preview again.', 409, 'PROJECT_CHANGED');
    throw new NotFound('Không tìm thấy cảnh.');
  }
  return getProject(id);
}

export type ProjectSceneDurationUpdate = {
  sceneId: string;
  audioFileId: string;
  voiceoverDurationSec: number;
  durationSec: number;
};

/** Apply a probe batch only to the project version and voiceover files that were measured. */
export async function setProjectSceneDurations(
  id: string,
  expectedVersion: number,
  updates: readonly ProjectSceneDurationUpdate[],
): Promise<ProjectDetail> {
  const project = await getProject(id);
  if (project.version !== expectedVersion) throw new AppError('Dự án vừa thay đổi, vui lòng tính lại thời lượng.', 409, 'PROJECT_CHANGED');
  const uniqueUpdates = [...new Map(updates.map((update) => [update.sceneId, update])).values()];
  if (uniqueUpdates.length === 0) return project;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const arrayFilters: Record<string, unknown>[] = [];
  const durationsBySceneId = new Map(project.scenes.map((scene) => [scene.id, scene.durationSec]));
  uniqueUpdates.forEach((update, index) => {
    const scene = project.scenes.find((candidate) => candidate.id === update.sceneId);
    if (!scene || scene.audioFileId !== update.audioFileId) {
      throw new AppError('Dự án vừa thay đổi, vui lòng tính lại thời lượng.', 409, 'PROJECT_CHANGED');
    }
    const alias = `durationScene${index}`;
    set[`scenes.$[${alias}].durationSec`] = update.durationSec;
    set[`scenes.$[${alias}].voiceoverDurationSec`] = update.voiceoverDurationSec;
    arrayFilters.push({ [`${alias}.id`]: update.sceneId, [`${alias}.audioFileId`]: update.audioFileId });
    durationsBySceneId.set(update.sceneId, update.durationSec);
  });

  let sceneOffset = 0;
  for (const [chapterIndex, chapter] of project.chapters.entries()) {
    const count = chapter.scenesCount ?? chapter.paragraphs.length;
    const durationSec = roundDurationSeconds(project.scenes
      .slice(sceneOffset, sceneOffset + count)
      .reduce((sum, scene) => sum + (durationsBySceneId.get(scene.id) ?? scene.durationSec), 0));
    set[`chapters.${chapterIndex}.durationSec`] = durationSec;
    sceneOffset += count;
  }

  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id, version: expectedVersion },
    { $set: set, $inc: { version: 1 } },
    { arrayFilters },
  );
  if (result.matchedCount === 0) {
    if (await findProjectById(id)) throw new AppError('Dự án vừa thay đổi, vui lòng tính lại thời lượng.', 409, 'PROJECT_CHANGED');
    throw new NotFound('Không tìm thấy dự án.');
  }
  return getProject(id);
}

export type ProjectNameCandidatesUpdate = {
  sceneId: string;
  expectedNarration: string;
  expectedAudioFileId: string;
  nameCandidates: NonNullable<SceneDoc['nameCandidates']>;
};

/** Store analyzed names only while the scene still matches the narration/audio snapshot sent to AI. */
export async function setProjectSceneNameCandidates(id: string, updates: readonly ProjectNameCandidatesUpdate[]): Promise<number> {
  const uniqueUpdates = [...new Map(updates.map((update) => [update.sceneId, update])).values()];
  if (uniqueUpdates.length === 0) return 0;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const arrayFilters: Record<string, unknown>[] = [];
  const eligibleSceneFilters: Record<string, unknown>[] = [];
  uniqueUpdates.forEach((update, index) => {
    const alias = `nameScene${index}`;
    set[`scenes.$[${alias}].nameCandidates`] = update.nameCandidates;
    arrayFilters.push({
      [`${alias}.id`]: update.sceneId,
      [`${alias}.narration`]: update.expectedNarration,
      [`${alias}.audioFileId`]: update.expectedAudioFileId,
    });
    eligibleSceneFilters.push({ scenes: { $elemMatch: { id: update.sceneId, narration: update.expectedNarration, audioFileId: update.expectedAudioFileId } } });
  });
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id, $or: eligibleSceneFilters } as never,
    { $set: set, $inc: { version: 1 } },
    { arrayFilters },
  );
  if (result.matchedCount === 0) {
    await getProject(id);
    return 0;
  }
  const updated = await getProject(id);
  return uniqueUpdates.filter((update) => {
    const scene = updated.scenes.find((candidate) => candidate.id === update.sceneId);
    return scene?.narration === update.expectedNarration
      && scene.audioFileId === update.expectedAudioFileId
      && scene.nameCandidates?.generatedAt === update.nameCandidates.generatedAt;
  }).length;
}

export type ProjectScenePopupPlanUpdate = {
  sceneId: string;
  expectedNarration: string;
  expectedAudioFileId: string;
  popupPlan: PopupPlan;
};

/** Store analyzed popup decisions only while the scene still matches its narration/audio snapshot. */
export async function setProjectScenePopupPlans(id: string, updates: readonly ProjectScenePopupPlanUpdate[]): Promise<number> {
  const uniqueUpdates = [...new Map(updates.map((update) => [update.sceneId, update])).values()];
  if (uniqueUpdates.length === 0) return 0;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const arrayFilters: Record<string, unknown>[] = [];
  const eligibleSceneFilters: Record<string, unknown>[] = [];
  uniqueUpdates.forEach((update, index) => {
    const alias = `popupScene${index}`;
    set[`scenes.$[${alias}].popupPlan`] = update.popupPlan;
    arrayFilters.push({
      [`${alias}.id`]: update.sceneId,
      [`${alias}.narration`]: update.expectedNarration,
      [`${alias}.audioFileId`]: update.expectedAudioFileId,
    });
    eligibleSceneFilters.push({ scenes: { $elemMatch: { id: update.sceneId, narration: update.expectedNarration, audioFileId: update.expectedAudioFileId } } });
  });
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id, $or: eligibleSceneFilters } as never,
    { $set: set, $inc: { version: 1 } },
    { arrayFilters },
  );
  if (result.matchedCount === 0) {
    await getProject(id);
    return 0;
  }
  const updated = await getProject(id);
  return uniqueUpdates.filter((update) => {
    const scene = updated.scenes.find((candidate) => candidate.id === update.sceneId);
    return scene?.narration === update.expectedNarration
      && scene.audioFileId === update.expectedAudioFileId
      && scene.popupPlan?.generatedAt === update.popupPlan.generatedAt;
  }).length;
}

export async function setProjectScenesAssetType(id: string, assetType: 'image' | 'video'): Promise<ProjectDetail> {
  const set: Record<string, unknown> = { 'scenes.$[].assetType': assetType, updatedAt: new Date() };
  if (assetType === 'video') set['scenes.$[].depthMap'] = null;
  if (assetType === 'image') {
    set['scenes.$[].videoKeyframeFileId'] = null;
    set['scenes.$[].videoTailFileId'] = null;
    set['scenes.$[].videoDurationSec'] = null;
  }
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id },
    { $set: set, $inc: { version: 1 } },
  );
  if (result.matchedCount === 0) throw new NotFound('Không tìm thấy dự án.');
  return getProject(id);
}

export async function setProjectBgm(id: string, mood: string, bgmFileId: string | null): Promise<ProjectDetail> {
  await updateProject(id, { bgmMood: mood, bgmFileId });
  return getProject(id);
}

export async function setProjectLogo(id: string, logoFileId: string | null): Promise<ProjectDetail> {
  await updateProject(id, { logoFileId });
  return getProject(id);
}

export async function patchProjectSeo(id: string, patch: SeoPatch): Promise<ProjectDetail> {
  const parsed = SeoPatchSchema.parse(patch);
  const current = await getProject(id);
  SeoPackageSchema.parse({
    ...current.seo,
    ...parsed,
    thumbnail: parsed.thumbnail ? { ...current.seo.thumbnail, ...parsed.thumbnail } : current.seo.thumbnail,
  });
  const fields = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [`seo.${key}`, value]));
  if (Object.keys(fields).length === 0) return getProject(id);
  await updateSeoFields(id, fields);
  return getProject(id);
}

export async function applyGeneratedSeoSections(
  id: string,
  sections: readonly SeoSection[],
  generated: GeneratedSeoSections,
): Promise<ProjectDetail> {
  const current = await getProject(id);
  const candidate = SeoPackageSchema.parse({
    ...current.seo,
    ...generated,
    thumbnail: generated.thumbnail ? { ...current.seo.thumbnail, ...generated.thumbnail } : current.seo.thumbnail,
  });
  const requested = new Set(sections);
  const fields: Record<string, unknown> = { 'seo.generatedBy': candidate.generatedBy };
  if (requested.has('titles')) {
    fields['seo.titles'] = candidate.titles;
    fields['seo.chosenTitleId'] = candidate.titles.some((item) => item.id === current.seo.chosenTitleId) ? current.seo.chosenTitleId : null;
  }
  if (requested.has('description')) fields['seo.descriptionIntro'] = candidate.descriptionIntro;
  if (requested.has('tags')) {
    fields['seo.tags'] = candidate.tags;
    fields['seo.hashtags'] = candidate.hashtags;
  }
  if (requested.has('pinnedComment')) fields['seo.pinnedComment'] = candidate.pinnedComment;
  if (requested.has('thumbnail')) {
    fields['seo.thumbnail.ideas'] = candidate.thumbnail.ideas;
    fields['seo.thumbnail.chosenIdeaId'] = candidate.thumbnail.ideas.some((item) => item.id === current.seo.thumbnail.chosenIdeaId)
      ? current.seo.thumbnail.chosenIdeaId
      : null;
    fields['seo.thumbnail.fileId'] = current.seo.thumbnail.fileId;
  }
  await updateSeoFields(id, fields);
  return getProject(id);
}

export async function setSeoThumbnailFile(id: string, fileId: string | null): Promise<ProjectDetail> {
  await updateSeoFields(id, { 'seo.thumbnail.fileId': fileId });
  return getProject(id);
}

async function updateSeoFields(id: string, fields: Record<string, unknown>): Promise<void> {
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id },
    { $set: { ...fields, updatedAt: new Date() }, $inc: { version: 1 } },
  );
  if (result.matchedCount === 0) throw new NotFound('Không tìm thấy dự án.');
}

export async function applyProjectVideoDistribution(
  id: string,
  toVideoSceneIds: string[],
  toImageSceneIds: string[],
  expectedVersion: number,
): Promise<ProjectDetail> {
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: id, version: expectedVersion },
    {
      $set: {
        'scenes.$[toVideo].assetType': 'video',
        'scenes.$[toVideo].depthMap': null,
        'scenes.$[toImage].assetType': 'image',
        'scenes.$[toImage].videoKeyframeFileId': null,
        'scenes.$[toImage].videoDurationSec': null,
        updatedAt: new Date(),
      },
      $inc: { version: 1 },
    },
    {
      arrayFilters: [
        { 'toVideo.id': { $in: toVideoSceneIds }, 'toVideo.assetFileId': null, 'toVideo.videoKeyframeFileId': null },
        { 'toImage.id': { $in: toImageSceneIds }, 'toImage.assetFileId': null, 'toImage.videoKeyframeFileId': null },
      ],
    },
  );
  if (result.matchedCount === 0) throw new AppError('Project changed, preview again.', 409, 'PROJECT_CHANGED');
  return getProject(id);
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

/** Commit a depth map only while the scene still points at the asset it analyzed. */
export async function setSceneDepthMap(
  projectId: string,
  sceneId: string,
  expectedAssetFileId: string,
  depthMap: NonNullable<SceneDoc['depthMap']>,
): Promise<boolean> {
  const result = await getCollection<ProjectDoc>('projects').updateOne(
    { _id: projectId, scenes: { $elemMatch: { id: sceneId, assetType: 'image', assetFileId: expectedAssetFileId } } },
    { $set: { 'scenes.$.depthMap': depthMap, updatedAt: new Date() }, $inc: { version: 1 } },
  );
  return result.matchedCount > 0;
}

export async function setProjectRenderFile(id: string, renderFileId: string): Promise<ProjectDetail> {
  await updateProject(id, { renderFileId, status: 'rendered' });
  return getProject(id);
}

export async function setProjectDraftRenderFile(id: string, draftRenderFileId: string): Promise<ProjectDetail> {
  await updateProject(id, { draftRenderFileId });
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

export async function setProjectTransitionStyle(id: string, transitionStyle: TransitionStyle): Promise<ProjectDetail> {
  await updateProject(id, { transitionStyle });
  return getProject(id);
}

export async function setProjectFilmLook(id: string, filmLook: FilmLookStyle): Promise<ProjectDetail> {
  await updateProject(id, { filmLook });
  return getProject(id);
}

export async function setProjectParallax(id: string, parallax: ParallaxStyle): Promise<ProjectDetail> {
  await updateProject(id, { parallax });
  return getProject(id);
}

export async function setProjectSceneTailSec(id: string, sceneTailSec: number): Promise<ProjectDetail> {
  await updateProject(id, { sceneTailSec });
  return getProject(id);
}

export async function setProjectSfxVolume(id: string, sfxVolume: number): Promise<ProjectDetail> {
  await updateProject(id, { sfxVolume });
  return getProject(id);
}

export async function setProjectVoiceSpeed(id: string, voiceSpeed: number): Promise<ProjectDetail> {
  await updateProject(id, { voiceSpeed: VoiceSpeedSchema.parse(voiceSpeed) });
  return getProject(id);
}

export async function setProjectAiProvider(id: string, aiProvider: AiProvider, aiModel?: string): Promise<ProjectDetail> {
  const current = await getProject(id);
  const selectedModel = aiModel ?? (current.aiProvider === aiProvider && current.aiModel && isAiModelForProvider(aiProvider, current.aiModel)
    ? current.aiModel
    : getDefaultAiModelId(aiProvider));
  if (!isAiModelForProvider(aiProvider, selectedModel)) {
    throw new AppError(`Model ${selectedModel} không còn khả dụng hoặc không thuộc ${aiProvider}; hãy chọn model khác.`, 422, 'AI_MODEL_UNAVAILABLE');
  }
  await updateProject(id, { aiProvider, aiModel: selectedModel });
  return getProject(id);
}

export async function setProjectVisualStylePreset(id: string, visualStylePresetId: VisualStyleId): Promise<ProjectDetail> {
  await updateProject(id, { visualStylePresetId });
  return getProject(id);
}

export async function applySceneAssets(
  id: string,
  assetUpdates: Array<{ sceneId: string; assetFileId?: string; videoKeyframeFileId?: string; videoTailFileId?: string | null; videoDurationSec?: number | null }>,
): Promise<ProjectDetail> {
  const project = await getProject(id);
  const latest = new Map<string, { sceneId: string; assetFileId?: string; videoKeyframeFileId?: string; videoTailFileId?: string | null; videoDurationSec?: number | null }>();
  for (const update of assetUpdates) latest.set(update.sceneId, { ...latest.get(update.sceneId), ...update });
  if (latest.size === 0) return project;
  for (const sceneId of latest.keys()) {
    if (!project.scenes.some((scene) => scene.id === sceneId)) throw new NotFound('Không tìm thấy cảnh.');
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const arrayFilters: Record<string, unknown>[] = [];
  let index = 0;
  for (const [sceneId, update] of latest) {
    const identifier = `scene${index}`;
    if (update.assetFileId !== undefined) {
      set[`scenes.$[${identifier}].assetFileId`] = update.assetFileId;
      set[`scenes.$[${identifier}].depthMap`] = null;
    }
    if (update.videoKeyframeFileId !== undefined) set[`scenes.$[${identifier}].videoKeyframeFileId`] = update.videoKeyframeFileId;
    if (update.videoTailFileId !== undefined) set[`scenes.$[${identifier}].videoTailFileId`] = update.videoTailFileId;
    if (update.videoDurationSec !== undefined) set[`scenes.$[${identifier}].videoDurationSec`] = update.videoDurationSec;
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
  motionPrompt?: string;
};

type EmptyScenePromptWriteResult = {
  project: ProjectDetail;
  updatedSceneIds: string[];
  updatedSfxPromptSceneIds: string[];
  updatedMotionPromptSceneIds: string[];
};

function hasPromptValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function isEmptyMotionPrompt(value: string | undefined): boolean {
  return value === undefined || value === '';
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
  const latest = new Map<string, { visualPrompt?: string; sfxPrompt?: string; motionPrompt?: string }>();
  for (const update of updates) {
    const current = latest.get(update.sceneId) ?? {};
    if (update.visualPrompt !== undefined) current.visualPrompt = update.visualPrompt;
    if (update.sfxPrompt !== undefined) current.sfxPrompt = update.sfxPrompt;
    if (update.motionPrompt !== undefined) current.motionPrompt = update.motionPrompt;
    latest.set(update.sceneId, current);
  }
  if (latest.size === 0) return { project, updatedSceneIds: [], updatedSfxPromptSceneIds: [], updatedMotionPromptSceneIds: [] };

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
    if (hasPromptValue(update.motionPrompt)) {
      const identifier = `motion${index}`;
      set[`scenes.$[${identifier}].motionPrompt`] = update.motionPrompt;
      arrayFilters.push({
        [`${identifier}.id`]: sceneId,
        $or: [{ [`${identifier}.motionPrompt`]: '' }, { [`${identifier}.motionPrompt`]: { $exists: false } }],
      });
      eligibleClauses.push({ id: sceneId, $or: [{ motionPrompt: '' }, { motionPrompt: { $exists: false } }] });
    }
  }
  if (eligibleClauses.length === 0) return { project, updatedSceneIds: [], updatedSfxPromptSceneIds: [], updatedMotionPromptSceneIds: [] };

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
  const updatedMotionPromptSceneIds = previous
    ? [...latest].filter(([sceneId, update]) => hasPromptValue(update.motionPrompt) && previous.scenes.some((scene) => scene.id === sceneId && isEmptyMotionPrompt(scene.motionPrompt))).map(([sceneId]) => sceneId)
    : [];
  return { project: await getProject(projectId), updatedSceneIds, updatedSfxPromptSceneIds, updatedMotionPromptSceneIds };
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
  const collection = getCollection<ProjectDoc>('projects');
  const arrayFilters = { arrayFilters: [{ 'elem.id': chapterId }] };
  const chapterFilter = { _id: id, 'chapters.id': chapterId };
  let result;
  if (snapshot?.historyBatchId) {
    const update: Record<string, unknown> = {
      $set: set,
      $push: { chapterHistory: { $each: [snapshot], $position: 0, $slice: 10 } },
      $inc: { version: 1 },
    };
    result = await collection.updateOne(
      { ...chapterFilter, 'chapterHistory.historyBatchId': { $ne: snapshot.historyBatchId } },
      update as never,
      arrayFilters,
    );
    if (result.matchedCount === 0) {
      result = await collection.updateOne(chapterFilter, { $set: set, $inc: { version: 1 } }, arrayFilters);
    }
  } else {
    const update: Record<string, unknown> = { $set: set };
    if (snapshot) update.$push = { chapterHistory: { $each: [snapshot], $position: 0, $slice: 10 } };
    result = await collection.updateOne(chapterFilter, { ...update, $inc: { version: 1 } }, arrayFilters);
  }
  if (result.matchedCount === 0 || result.modifiedCount === 0) throw new NotFound('Không tìm thấy chương.');
  return getProject(id);
}

export async function restoreProjectChapters(id: string, chapters: ChapterDoc[], snapshot: ChapterSnapshot, expectedVersion?: number): Promise<ProjectDetail> {
  await updateProject(id, { chapters }, snapshot, expectedVersion);
  return getProject(id);
}

export async function getProjectHistory(id: string): Promise<ChapterSnapshot[]> {
  const project = await findProjectById(id);
  if (!project) throw new NotFound('Không tìm thấy dự án.');
  return project.chapterHistory;
}

async function updateProject(id: string, fields: Record<string, unknown>, snapshot: ChapterSnapshot | null = null, expectedVersion?: number): Promise<void> {
  const $set = { ...fields, updatedAt: new Date() };
  const update: Record<string, unknown> = { $set, $inc: { version: 1 } };
  if (snapshot) update.$push = { chapterHistory: { $each: [snapshot], $position: 0, $slice: 10 } };
  const filter = expectedVersion === undefined ? { _id: id } : { _id: id, version: expectedVersion };
  const result = await getCollection<ProjectDoc>('projects').updateOne(filter, update as never);
  if (result.matchedCount === 0) {
    if (expectedVersion !== undefined) throw new Conflict('Dự án đã thay đổi kể từ lượt áp dụng; không thể hoàn tác an toàn.');
    throw new NotFound('Không tìm thấy dự án.');
  }
}
