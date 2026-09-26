import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import type { RemotionSceneProps } from '../contracts/video';
import { SFX_VOLUME_NUMBER } from '../contracts/video';
import { kenBurnsTransform } from './frame-math';

export type SceneSequenceProps = {
  scene: RemotionSceneProps;
  audioTiming: { from: number; durationInFrames: number };
  visualTiming: { from: number; durationInFrames: number; fadeInFrames: number };
};

function ImageScene({ scene, durationInFrames }: { scene: RemotionSceneProps; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { scale, translateXPercent, translateYPercent } = kenBurnsTransform(frame, durationInFrames, scene.id);
  return (
    <Img
      src={staticFile(scene.assetRelPath)}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        transform: `scale(${scale}) translate(${translateXPercent}%, ${translateYPercent}%)`,
      }}
    />
  );
}

function SceneVisual({ scene, realDurationInFrames, fadeInFrames }: {
  scene: RemotionSceneProps;
  realDurationInFrames: number;
  fadeInFrames: number;
}) {
  const frame = useCurrentFrame();
  const opacity = fadeInFrames === 0 ? 1 : interpolate(frame, [0, fadeInFrames], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ backgroundColor: 'black', opacity }}>
      {scene.assetType === 'video' ? (
        <OffthreadVideo muted src={staticFile(scene.assetRelPath)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <ImageScene scene={scene} durationInFrames={realDurationInFrames} />
      )}
    </AbsoluteFill>
  );
}

export function SceneSequence({ scene, audioTiming, visualTiming }: SceneSequenceProps) {
  return (
    <>
      <Sequence from={visualTiming.from} durationInFrames={visualTiming.durationInFrames}>
        <SceneVisual scene={scene} realDurationInFrames={audioTiming.durationInFrames} fadeInFrames={visualTiming.fadeInFrames} />
      </Sequence>
      <Sequence from={audioTiming.from} durationInFrames={audioTiming.durationInFrames}>
        {scene.voiceRelPath ? <Audio src={staticFile(scene.voiceRelPath)} /> : null}
        {scene.sfxRelPath ? <Audio src={staticFile(scene.sfxRelPath)} volume={SFX_VOLUME_NUMBER} /> : null}
      </Sequence>
    </>
  );
}
