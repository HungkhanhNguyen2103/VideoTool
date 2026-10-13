export type SceneActivationState = { active?: boolean };

/** Missing active flags are treated as enabled for legacy and partial scene data. */
export function isSceneActive(scene: SceneActivationState): boolean {
  return scene.active !== false;
}

/** Keep scene order and ids intact while omitting scenes that are switched off. */
export function activeScenes<T extends SceneActivationState>(scenes: readonly T[]): T[] {
  return scenes.filter(isSceneActive);
}

export function countInactiveScenes(scenes: readonly SceneActivationState[]): number {
  return scenes.length - activeScenes(scenes).length;
}
