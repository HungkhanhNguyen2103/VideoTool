import type { RemotionSceneProps } from '../contracts/video';

export function sceneDurationInFrames(durationSec: number, fps: number): number {
  return Math.round(durationSec * fps);
}

export type KenBurnsTransform = {
  scale: number;
  translateXPercent: number;
  translateYPercent: number;
};

export function kenBurnsTransform(frame: number, durationInFrames: number, seed: string): KenBurnsTransform {
  // A sub-second scene at 30 fps stays still instead of completing a visible zoom in a snap.
  if (durationInFrames < 30) return { scale: 1, translateXPercent: 0, translateYPercent: 0 };

  let hash = 0;
  for (const character of seed) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));
  const eased = 1 - (1 - progress) ** 3;
  const motion = hash % 2 === 0 ? eased : 1 - eased;
  const pan = motion * 1.2;
  const axis = Math.floor(hash / 2) % 4;

  return {
    scale: 1 + motion * 0.08,
    translateXPercent: axis < 2 ? pan * (axis === 0 ? 1 : -1) : 0,
    translateYPercent: axis >= 2 ? pan * (axis === 2 ? 1 : -1) : 0,
  };
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

const CROSSFADE_SECONDS = 0.5;
const MIN_FADE_SCENE_MULTIPLIER = 3;

export function sceneVisualTimings(
  scenes: ReadonlyArray<Pick<RemotionSceneProps, 'id' | 'durationSec' | 'assetType'>>,
  fps: number,
): Array<{ id: string; from: number; durationInFrames: number; fadeInFrames: number }> {
  const transitionFrames = Math.round(CROSSFADE_SECONDS * fps);
  return sceneFrameTimings(scenes, fps).map((timing, index) => ({
    id: timing.id,
    from: timing.from,
    durationInFrames: timing.durationInFrames + (index < scenes.length - 1 && scenes[index]!.assetType === 'image' ? transitionFrames : 0),
    fadeInFrames: index > 0 && timing.durationInFrames >= MIN_FADE_SCENE_MULTIPLIER * transitionFrames ? transitionFrames : 0,
  }));
}

export function totalDurationInFrames(
  scenes: ReadonlyArray<Pick<RemotionSceneProps, 'durationSec'>>,
  fps: number,
): number {
  const totalDurationSec = scenes.reduce((total, scene) => total + scene.durationSec, 0);
  return Math.round(totalDurationSec * fps);
}
