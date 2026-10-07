// Public API of the project module. Nothing else in this module may be imported from outside.
export { createProjectRouter, projectRouter } from './routes';
export { ensureProjectIndexes } from './indexes';
export {
  applyEmptySceneVisualPrompts,
  applyEmptySceneVisualPromptsWithResult,
  applyProjectVideoDistribution,
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  getProjectHistory,
  listProjects,
  applySceneAssets,
  patchProjectScene,
  setSceneWordTimings,
  setSceneDepthMap,
  setProjectSceneNameCandidates,
  patchProjectChapter,
  replaceProjectChapters,
  replaceProjectScript,
  replaceProjectScenes,
  restoreProjectChapters,
  setProjectScenesAssetType,
  setProjectBgm,
  setProjectLogo,
  setProjectKeywordPopups,
  setProjectTransitionStyle,
  setProjectFilmLook,
  setProjectParallax,
  setProjectRenderEngine,
  setProjectAiProvider,
  setProjectVisualStylePreset,
  setProjectRenderFile,
  setProjectDraftRenderFile,
  patchProjectSeo,
  applyGeneratedSeoSections,
  setSeoThumbnailFile,
} from './service';
export { SceneDocSchema } from './docs';
export type { ProjectDoc, SceneDoc } from './docs';
export { pickVideoSceneIndexes } from './video-scene-picker';
