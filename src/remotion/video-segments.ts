export const VIDEO_KEYFRAME_CROSSFADE_SEC = 0.35;

export type VideoKeyframeSegmentPlan = {
  videoFrames: number;
  imageFrom: number;
  imageFrames: number;
  crossfadeFrames: number;
};

export function planVideoKeyframeSegments(input: {
  sceneDurationInFrames: number;
  fps: number;
  videoDurationSec: number | null | undefined;
  hasKeyframe: boolean;
}): VideoKeyframeSegmentPlan | null {
  if (!input.hasKeyframe || input.videoDurationSec === null || input.videoDurationSec === undefined || input.videoDurationSec <= 0) return null;
  const videoFrames = Math.max(1, Math.round(input.videoDurationSec * input.fps));
  if (videoFrames >= input.sceneDurationInFrames) return null;
  const crossfadeFrames = Math.max(1, Math.min(
    Math.round(VIDEO_KEYFRAME_CROSSFADE_SEC * input.fps),
    videoFrames,
    input.sceneDurationInFrames - videoFrames,
  ));
  const imageFrom = videoFrames - crossfadeFrames;
  return {
    videoFrames,
    imageFrom,
    imageFrames: input.sceneDurationInFrames - imageFrom,
    crossfadeFrames,
  };
}
