export type VideoKeyframeSegmentPlan = {
  videoFrames: number;
  imageFrom: number;
  imageFrames: number;
  videoFrom: number;
  stillSource: 'keyframe' | 'clip';
};

export function planVideoKeyframeSegments(input: {
  sceneDurationInFrames: number;
  fps: number;
  videoDurationSec: number | null | undefined;
  hasKeyframe: boolean;
}): VideoKeyframeSegmentPlan | null {
  if (input.videoDurationSec === null || input.videoDurationSec === undefined || input.videoDurationSec <= 0) return null;
  const videoFrames = Math.max(1, Math.round(input.videoDurationSec * input.fps));
  if (videoFrames >= input.sceneDurationInFrames) return null;
  const imageFrom = 0;
  const imageFrames = input.sceneDurationInFrames - videoFrames;
  return {
    videoFrames,
    imageFrom,
    imageFrames,
    videoFrom: imageFrames,
    stillSource: input.hasKeyframe ? 'keyframe' : 'clip',
  };
}
