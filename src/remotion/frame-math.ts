import type { RemotionSceneProps } from '../contracts/video';
import type { TransitionStyle } from '../contracts/project';

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

export const CROSSFADE_SECONDS = 0.5;
export const WIPE_SECONDS = 0.6;
export const WHIP_PAN_SECONDS = 0.4;
export const ZOOM_THROUGH_SECONDS = 0.5;
export const LIGHT_LEAK_SECONDS = 0.7;
export const FILM_BURN_SECONDS = 0.7;
export const MIN_TRANSITION_SCENE_MULTIPLIER = 3;

export const TRANSITION_TYPES = ['crossfade', 'wipe', 'whipPan', 'zoomThrough', 'lightLeak', 'filmBurn'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];
export type TransitionPlan = { type: TransitionType; frames: number };

const TRANSITION_WEIGHTS: Record<TransitionType, number> = {
  crossfade: 40,
  wipe: 15,
  whipPan: 15,
  zoomThrough: 10,
  lightLeak: 10,
  filmBurn: 10,
};

const TRANSITION_SECONDS: Record<TransitionType, number> = {
  crossfade: CROSSFADE_SECONDS,
  wipe: WIPE_SECONDS,
  whipPan: WHIP_PAN_SECONDS,
  zoomThrough: ZOOM_THROUGH_SECONDS,
  lightLeak: LIGHT_LEAK_SECONDS,
  filmBurn: FILM_BURN_SECONDS,
};

function hashString(value: string): number {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

function weightedType(hash: number): TransitionType {
  const target = (hash >>> 0) % 100;
  let cursor = 0;
  for (const type of TRANSITION_TYPES) {
    cursor += TRANSITION_WEIGHTS[type];
    if (target < cursor) return type;
  }
  return 'filmBurn';
}

function transitionFrames(type: TransitionType, fps: number): number {
  return Math.max(1, Math.round(TRANSITION_SECONDS[type] * fps));
}

function fitTransition(type: TransitionType, incomingDurationInFrames: number, fps: number): TransitionPlan {
  const frames = transitionFrames(type, fps);
  if (incomingDurationInFrames >= MIN_TRANSITION_SCENE_MULTIPLIER * frames) return { type, frames };
  const crossfadeFrames = transitionFrames('crossfade', fps);
  if (incomingDurationInFrames >= MIN_TRANSITION_SCENE_MULTIPLIER * crossfadeFrames) return { type: 'crossfade', frames: crossfadeFrames };
  return { type: 'crossfade', frames: 0 };
}

export function planTransitions(
  scenes: ReadonlyArray<Pick<RemotionSceneProps, 'id' | 'durationSec' | 'assetType'>>,
  fps: number,
  style: TransitionStyle = 'varied',
): TransitionPlan[] {
  const plans: TransitionPlan[] = [];
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const outgoing = scenes[index]!;
    const incoming = scenes[index + 1]!;
    const weighted = style === 'crossfade' || outgoing.assetType === 'video'
      ? 'crossfade'
      : weightedType(hashString(incoming.id));
    let type = weighted;
    if (style === 'varied' && outgoing.assetType === 'image' && plans.at(-1)?.type === weighted) {
      const hash = hashString(incoming.id) ^ 0x9e3779b9;
      for (let offset = 0; offset < TRANSITION_TYPES.length; offset += 1) {
        const candidate = weightedType(hash + offset * 17);
        if (candidate !== plans.at(-1)?.type) {
          type = candidate;
          break;
        }
      }
    }
    plans.push(fitTransition(type, sceneDurationInFrames(incoming.durationSec, fps), fps));
  }
  return plans;
}

export function sceneVisualTimings(
  scenes: ReadonlyArray<Pick<RemotionSceneProps, 'id' | 'durationSec' | 'assetType'>>,
  fps: number,
  style: TransitionStyle = 'varied',
): Array<{ id: string; from: number; durationInFrames: number; fadeInFrames: number; incomingTransition: TransitionPlan | null; outgoingTransition: TransitionPlan | null }> {
  const plans = planTransitions(scenes, fps, style);
  return sceneFrameTimings(scenes, fps).map((timing, index) => {
    const incomingTransition = index > 0 ? plans[index - 1]! : null;
    const outgoingTransition = index < plans.length ? plans[index]! : null;
    return {
    id: timing.id,
    from: timing.from,
    durationInFrames: timing.durationInFrames + (outgoingTransition && scenes[index]!.assetType === 'image' ? outgoingTransition.frames : 0),
    fadeInFrames: incomingTransition?.frames ?? 0,
    incomingTransition,
    outgoingTransition,
    };
  });
}

export function totalDurationInFrames(
  scenes: ReadonlyArray<Pick<RemotionSceneProps, 'durationSec'>>,
  fps: number,
): number {
  const totalDurationSec = scenes.reduce((total, scene) => total + scene.durationSec, 0);
  return Math.round(totalDurationSec * fps);
}
