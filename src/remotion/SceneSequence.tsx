import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile } from 'remotion';
import type { RemotionSceneProps } from '../contracts/video';
import { SFX_VOLUME_NUMBER } from '../contracts/video';
import { sceneDurationInFrames } from './frame-math';

export type SceneSequenceProps = {
  scene: RemotionSceneProps;
  from: number;
  fps: number;
};

export function SceneSequence({ scene, from, fps }: SceneSequenceProps) {
  const durationInFrames = sceneDurationInFrames(scene.durationSec, fps);
  return (
    <Sequence from={from} durationInFrames={durationInFrames}>
      <AbsoluteFill style={{ backgroundColor: 'black' }}>
        {scene.assetType === 'video' ? (
          <OffthreadVideo src={staticFile(scene.assetPath)} style={{ width: '100%', height: '100%' }} />
        ) : (
          <Img src={staticFile(scene.assetPath)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        )}
        {scene.audioPath ? <Audio src={staticFile(scene.audioPath)} /> : null}
        {scene.sfxPath ? <Audio src={staticFile(scene.sfxPath)} volume={SFX_VOLUME_NUMBER} /> : null}
      </AbsoluteFill>
    </Sequence>
  );
}
