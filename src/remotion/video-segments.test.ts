import { describe, expect, it } from 'vitest';
import { VIDEO_KEYFRAME_CROSSFADE_SEC, planVideoKeyframeSegments } from './video-segments';

describe('video/keyframe segment planning', () => {
  it('overlaps a short video and trailing keyframe by the local crossfade', () => {
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 180, fps: 30, videoDurationSec: 2, hasKeyframe: true })).toEqual({
      videoFrames: 60,
      imageFrom: 60 - Math.round(VIDEO_KEYFRAME_CROSSFADE_SEC * 30),
      imageFrames: 180 - (60 - Math.round(VIDEO_KEYFRAME_CROSSFADE_SEC * 30)),
      crossfadeFrames: Math.round(VIDEO_KEYFRAME_CROSSFADE_SEC * 30),
    });
  });

  it('falls back to one video segment when the keyframe split is not applicable', () => {
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 90, fps: 30, videoDurationSec: null, hasKeyframe: true })).toBeNull();
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 90, fps: 30, videoDurationSec: 1, hasKeyframe: false })).toBeNull();
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 90, fps: 30, videoDurationSec: 3, hasKeyframe: true })).toBeNull();
  });
});
