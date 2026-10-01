import type { Scene } from '../../../contracts/project';
import { analyzeScene, type SceneReadiness, type SceneReadinessStatus } from '../../../contracts/scene-readiness';

export type RenderReadinessIssue = SceneReadiness & {
  sceneId: string;
  sceneNumber: number;
  blocking: boolean;
  confirmBeforeRender: boolean;
};

export type RenderReadinessSummary = {
  total: number;
  ready: number;
  warnings: number;
  errors: number;
  issues: RenderReadinessIssue[];
  blockers: RenderReadinessIssue[];
  confirmations: RenderReadinessIssue[];
};

const BLOCKING_STATUSES: ReadonlySet<SceneReadinessStatus> = new Set(['missing-asset', 'missing-clip', 'keyframe-only']);
const CONFIRM_STATUSES: ReadonlySet<SceneReadinessStatus> = new Set(['clip-cut']);

export function summarizeRenderReadiness(scenes: ReadonlyArray<Scene>): RenderReadinessSummary {
  const issues: RenderReadinessIssue[] = [];
  let ready = 0;
  let warnings = 0;
  let errors = 0;

  for (const [index, scene] of scenes.entries()) {
    const readiness = analyzeScene(scene);
    if (readiness.status === 'ok') {
      ready += 1;
      continue;
    }
    const blocking = BLOCKING_STATUSES.has(readiness.status);
    const issue = { ...readiness, sceneId: scene.id, sceneNumber: index + 1, blocking, confirmBeforeRender: !blocking && CONFIRM_STATUSES.has(readiness.status) };
    issues.push(issue);
    if (blocking) errors += 1;
    else warnings += 1;
  }

  return {
    total: scenes.length,
    ready,
    warnings,
    errors,
    issues,
    blockers: issues.filter((issue) => issue.blocking),
    confirmations: issues.filter((issue) => issue.confirmBeforeRender),
  };
}
