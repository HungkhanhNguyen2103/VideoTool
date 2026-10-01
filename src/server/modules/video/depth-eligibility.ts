import type { ParallaxStyle, Scene } from '../../../contracts/project';

/** Calibrated against all 30 Kodak image scenes on 2026-09-27. */
export const DEPTH_MAP_ELIGIBILITY_THRESHOLD = 0.94;

export function isDepthMapEligible(score: number): boolean {
  return Number.isFinite(score) && score >= DEPTH_MAP_ELIGIBILITY_THRESHOLD;
}

export function isDepthSceneEligible(parallax: ParallaxStyle, scene: Pick<Scene, 'assetType' | 'assetFileId' | 'depthMap'>): boolean {
  return parallax === 'auto'
    && scene.assetType === 'image'
    && scene.assetFileId !== null
    && scene.depthMap?.assetFileId === scene.assetFileId
    && isDepthMapEligible(scene.depthMap.score);
}

export function hasUsableDepthScene(parallax: ParallaxStyle, scenes: ReadonlyArray<Pick<Scene, 'assetType' | 'assetFileId' | 'depthMap'>>): boolean {
  return scenes.some((scene) => isDepthSceneEligible(parallax, scene));
}
