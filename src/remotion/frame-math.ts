import type { RemotionSceneProps } from '../contracts/video';

export function sceneDurationInFrames(durationSec: number, fps: number): number {
  return Math.round(durationSec * fps);
}

export function sceneFrameTimings(
  scenes: ReadonlyArray<Pick<RemotionSceneProps, 'id' | 'durationSec'>>,
  fps: number,
): Array<{ id: string; from: number; durationInFrames: number }> {
  let from = 0;
  return scenes.map((scene) => {
    const durationInFrames = sceneDurationInFrames(scene.durationSec, fps);
    const timing = { id: scene.id, from, durationInFrames };
    from += durationInFrames;
    return timing;
  });
}

export function totalDurationInFrames(
  scenes: ReadonlyArray<Pick<RemotionSceneProps, 'durationSec'>>,
  fps: number,
): number {
  return scenes.reduce((total, scene) => total + sceneDurationInFrames(scene.durationSec, fps), 0);
}
