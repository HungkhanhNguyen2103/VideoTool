// Public API of the project module. Nothing else in this module may be imported from outside.
export { projectRouter } from './routes';
export { ensureProjectIndexes } from './indexes';
export {
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  getProjectHistory,
  listProjects,
  applySceneAssets,
  patchProjectScene,
  patchProjectChapter,
  replaceProjectChapters,
  replaceProjectScenes,
  restoreProjectChapters,
  setProjectScenesAssetType,
} from './service';
export { SceneDocSchema } from './docs';
export type { ProjectDoc, SceneDoc } from './docs';
