import type { ProjectDetail as Project } from '../../../contracts/project';
import { activeScenes } from '../../../contracts/scene-active';
import { analyzeScene, type SceneReadinessStatus } from '../../../contracts/scene-readiness';

export type PipelineStepKey =
  | 'script' | 'visualPrompt' | 'assets' | 'voiceover' | 'sfx' | 'draft' | 'final';

export type PipelineStep = {
  key: PipelineStepKey;
  label: string;
  weight: number;
  done: number;
  total: number;
  ratio: number;
};

export type PipelineProgress = { percent: number; steps: PipelineStep[] };

// Rough effort estimates chosen by the owner; these weights can be tuned as the workflow changes.
const PIPELINE_WEIGHTS: Record<PipelineStepKey, number> = {
  script: 10,
  visualPrompt: 10,
  assets: 35,
  voiceover: 15,
  sfx: 5,
  draft: 10,
  final: 15,
};

const PIPELINE_LABELS: Record<PipelineStepKey, string> = {
  script: 'Kịch bản & chia cảnh',
  visualPrompt: 'Visual prompt',
  assets: 'Hình & clip',
  voiceover: 'Voiceover',
  sfx: 'SFX',
  draft: 'Render nháp',
  final: 'Render cuối',
};

const INCOMPLETE_ASSET_STATUSES: ReadonlySet<SceneReadinessStatus> = new Set([
  'missing-asset', 'missing-clip', 'keyframe-only',
]);

function makeStep(key: PipelineStepKey, done: number, total: number): PipelineStep {
  return {
    key,
    label: PIPELINE_LABELS[key],
    weight: PIPELINE_WEIGHTS[key],
    done,
    total,
    ratio: total === 0 ? 0 : done / total,
  };
}

export function computePipelineProgress(project: Project): PipelineProgress {
  const scenes = activeScenes(project.scenes);
  const totalScenes = scenes.length;
  const assetsDone = scenes.filter((scene) => !INCOMPLETE_ASSET_STATUSES.has(analyzeScene(scene).status)).length;
  const steps = [
    makeStep('script', totalScenes > 0 ? 1 : 0, 1),
    makeStep('visualPrompt', scenes.filter((scene) => scene.visualPrompt.trim().length > 0).length, totalScenes),
    makeStep('assets', assetsDone, totalScenes),
    makeStep('voiceover', scenes.filter((scene) => scene.audioFileId !== null).length, totalScenes),
    makeStep('sfx', scenes.filter((scene) => scene.sfxFileId !== null).length, totalScenes),
    makeStep('draft', project.draftRenderFileId !== null ? 1 : 0, 1),
    makeStep('final', project.renderFileId !== null ? 1 : 0, 1),
  ];
  const weightedPercent = steps.reduce((sum, step) => sum + step.weight * step.ratio, 0);
  return { percent: Math.min(100, Math.max(0, Math.round(weightedPercent))), steps };
}
