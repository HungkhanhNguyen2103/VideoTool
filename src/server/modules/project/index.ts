// Public API of the project module. Nothing else in this module may be imported from outside.
export { projectRouter } from './routes';
export { ensureProjectIndexes } from './indexes';
export { createProject, deleteProject, duplicateProject, getProject, listProjects, replaceProjectScenes } from './service';
export type { ProjectDoc, SceneDoc } from './docs';
