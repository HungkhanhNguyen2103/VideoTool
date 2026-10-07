import { describe, expect, it } from 'vitest';
import { planVideoKeyframeSegments } from './video-segments';

describe('video/keyframe segment planning', () => {
  it('pads before a short video and starts the clip at its own frame zero', () => {
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 360, fps: 30, videoDurationSec: 8, hasKeyframe: true })).toEqual({
      imageFrom: 0,
      imageFrames: 120,
      videoFrom: 120,
      videoFrames: 240,
      stillSource: 'keyframe',
    });
  });

  it('plans the same leading freeze when no keyframe asset exists', () => {
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 360, fps: 30, videoDurationSec: 8, hasKeyframe: false })).toEqual({
      imageFrom: 0,
      imageFrames: 120,
      videoFrom: 120,
      videoFrames: 240,
      stillSource: 'clip',
    });
  });

  it('handles a very short clip without a zero-length segment', () => {
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 30, fps: 30, videoDurationSec: 0.01, hasKeyframe: false })).toEqual({
      imageFrom: 0,
      imageFrames: 29,
      videoFrom: 29,
      videoFrames: 1,
      stillSource: 'clip',
    });
  });

  it('uses one segment when timing is unknown, equal, or longer than the scene', () => {
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 90, fps: 30, videoDurationSec: null, hasKeyframe: false })).toBeNull();
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 90, fps: 30, videoDurationSec: 3, hasKeyframe: true })).toBeNull();
    expect(planVideoKeyframeSegments({ sceneDurationInFrames: 90, fps: 30, videoDurationSec: 4, hasKeyframe: true })).toBeNull();
  });
});
