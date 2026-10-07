/** Shared seconds-to-frames rounding used by both video renderers and chapter timestamps. */
export function secondsToFrames(durationSec: number, fps: number): number {
  return Math.round(durationSec * fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

export function sceneFrames(durationsSec: readonly number[], fps: number): number[] {
  return durationsSec.map((durationSec) => secondsToFrames(durationSec, fps));
}

export function frameAlignedDurationSec(durationSec: number, fps: number): number {
  return framesToSeconds(secondsToFrames(durationSec, fps), fps);
}

export function totalSceneFrames(durationsSec: readonly number[], fps: number): number {
  return sceneFrames(durationsSec, fps).reduce((total, frames) => total + frames, 0);
}
