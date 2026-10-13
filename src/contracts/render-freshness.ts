import type { ProjectDetail } from './project';
import { activeScenes } from './scene-active';

type RenderFreshnessProject = Pick<ProjectDetail, 'renderFileId' | 'renderedActiveSceneIds' | 'scenes'>;

/** Legacy renders without a saved scene snapshot are considered fresh. */
export function isRenderStale(project: RenderFreshnessProject): boolean {
  const renderedIds = project.renderedActiveSceneIds;
  if (!project.renderFileId || renderedIds === undefined) return false;

  const currentIds = activeScenes(project.scenes).map((scene) => scene.id);
  return currentIds.length !== renderedIds.length || currentIds.some((sceneId, index) => sceneId !== renderedIds[index]);
}
