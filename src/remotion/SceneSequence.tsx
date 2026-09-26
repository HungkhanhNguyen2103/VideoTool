import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import type { RemotionSceneProps } from '../contracts/video';
import { SFX_VOLUME_NUMBER } from '../contracts/video';
import { kenBurnsTransform, sceneDurationInFrames } from './frame-math';

export type SceneSequenceProps = {
  scene: RemotionSceneProps;
  from: number;
  fps: number;
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

export function SceneSequence({ scene, from, fps }: SceneSequenceProps) {
  const durationInFrames = sceneDurationInFrames(scene.durationSec, fps);
  return (
    <Sequence from={from} durationInFrames={durationInFrames}>
      <AbsoluteFill style={{ backgroundColor: 'black' }}>
        {scene.assetType === 'video' ? (
          <OffthreadVideo muted src={staticFile(scene.assetRelPath)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <ImageScene scene={scene} durationInFrames={durationInFrames} />
        )}
        {scene.voiceRelPath ? <Audio src={staticFile(scene.voiceRelPath)} /> : null}
        {scene.sfxRelPath ? <Audio src={staticFile(scene.sfxRelPath)} volume={SFX_VOLUME_NUMBER} /> : null}
      </AbsoluteFill>
    </Sequence>
  );
}
