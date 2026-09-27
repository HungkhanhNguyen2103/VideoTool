// Public API of the project module. Nothing else in this module may be imported from outside.
export { projectRouter } from './routes';
export { ensureProjectIndexes } from './indexes';
export {
  applyEmptySceneVisualPrompts,
  applyEmptySceneVisualPromptsWithResult,
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  getProjectHistory,
  listProjects,
  applySceneAssets,
  patchProjectScene,
  setSceneWordTimings,
  patchProjectChapter,
  replaceProjectChapters,
  replaceProjectScript,
  replaceProjectScenes,
  restoreProjectChapters,
  setProjectScenesAssetType,
  setProjectBgm,
  setProjectCustomStyleReferenceFile,
  setProjectKeywordPopups,
  setProjectRenderEngine,
  setProjectAiProvider,
  setProjectVisualStylePreset,
  setProjectRenderFile,
} from './service';
export { SceneDocSchema } from './docs';
export type { ProjectDoc, SceneDoc } from './docs';
