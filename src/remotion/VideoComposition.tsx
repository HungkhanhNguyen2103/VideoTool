import { AbsoluteFill, Audio, Composition, staticFile } from 'remotion';
import type { RemotionInputProps } from '../contracts/video';
import { BGM_VOLUME_NUMBER } from '../contracts/video';
import { sceneFrameTimings, sceneVisualTimings, totalDurationInFrames } from './frame-math';
import { SceneSequence } from './SceneSequence';

export const VIDEO_COMPOSITION_ID = 'VideoComposition';

export const DEFAULT_REMOTION_PROPS: RemotionInputProps = {
  fps: 30,
  width: 1920,
  height: 1080,
  scenes: [],
  bgmRelPath: null,
  transitionStyle: 'varied',
  parallax: 'off',
};

export function VideoComposition(props: RemotionInputProps) {
  const audioTimings = sceneFrameTimings(props.scenes, props.fps);
  const visualTimings = sceneVisualTimings(props.scenes, props.fps, props.transitionStyle);
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {props.scenes.map((scene, index) => (
        <SceneSequence
          key={scene.id}
          scene={scene}
          boundaryIndex={index}
          audioTiming={audioTimings[index]!}
          visualTiming={visualTimings[index]!}
        />
      ))}
      {props.bgmRelPath ? <Audio src={staticFile(props.bgmRelPath)} volume={BGM_VOLUME_NUMBER} loop /> : null}
    </AbsoluteFill>
  );
}

export function RemotionComposition() {
  return (
    <Composition
      id={VIDEO_COMPOSITION_ID}
      component={VideoComposition}
      defaultProps={DEFAULT_REMOTION_PROPS}
      width={DEFAULT_REMOTION_PROPS.width}
      height={DEFAULT_REMOTION_PROPS.height}
      fps={DEFAULT_REMOTION_PROPS.fps}
      durationInFrames={1}
      calculateMetadata={({ props }) => ({
        durationInFrames: totalDurationInFrames(props.scenes, props.fps),
        width: props.width,
        height: props.height,
        fps: props.fps,
      })}
    />
  );
}
