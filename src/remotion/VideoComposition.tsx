import { AbsoluteFill, Audio, Composition } from 'remotion';
import type { RemotionInputProps } from '../contracts/video';
import { BGM_VOLUME_NUMBER } from '../contracts/video';
import { sceneFrameTimings, totalDurationInFrames } from './frame-math';
import { SceneSequence } from './SceneSequence';

export const VIDEO_COMPOSITION_ID = 'VideoComposition';

export const DEFAULT_REMOTION_PROPS: RemotionInputProps = {
  fps: 30,
  width: 1920,
  height: 1080,
  scenes: [],
  bgmPath: null,
};

export function VideoComposition(props: RemotionInputProps) {
  const timings = sceneFrameTimings(props.scenes, props.fps);
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {timings.map((timing) => {
        const scene = props.scenes.find((candidate) => candidate.id === timing.id);
        return scene ? <SceneSequence key={scene.id} scene={scene} from={timing.from} fps={props.fps} /> : null;
      })}
      {props.bgmPath ? <Audio src={props.bgmPath} volume={BGM_VOLUME_NUMBER} loop /> : null}
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
