import type { CSSProperties } from 'react';
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import type { RemotionSceneProps } from '../contracts/video';
import { SFX_VOLUME_NUMBER } from '../contracts/video';
import type { TransitionPlan } from './frame-math';
import { kenBurnsTransform } from './frame-math';
import { KeywordOverlay } from './KeywordOverlay';
import { FilmLook } from './FilmLook';

export type SceneSequenceProps = {
  scene: RemotionSceneProps;
  audioTiming: { from: number; durationInFrames: number };
  visualTiming: { from: number; durationInFrames: number; fadeInFrames: number; incomingTransition: TransitionPlan | null; outgoingTransition: TransitionPlan | null };
  boundaryIndex: number;
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

type TransitionVisual = {
  contentStyle: CSSProperties;
  overlayStyle?: CSSProperties;
  filterId?: string;
  blurX?: number;
};

function incomingTransitionVisual(plan: TransitionPlan, progress: number, direction: number, sceneId: string): TransitionVisual {
  if (plan.type === 'crossfade' || plan.type === 'lightLeak' || plan.type === 'filmBurn') return { contentStyle: { opacity: progress } };
  if (plan.type === 'wipe') {
    const edge = progress * 100;
    const featherStart = Math.max(0, edge - 8);
    const featherEnd = Math.min(100, edge + 8);
    const gradient = direction > 0
      ? `linear-gradient(90deg, #fff ${featherStart}%, transparent ${featherEnd}%)`
      : `linear-gradient(270deg, #fff ${featherStart}%, transparent ${featherEnd}%)`;
    return {
      contentStyle: {
        maskImage: gradient,
        WebkitMaskImage: gradient,
      },
    };
  }
  if (plan.type === 'whipPan') return {
    contentStyle: { transform: `translateX(${direction * -100 * (1 - progress)}%)` },
    blurX: 12 * (1 - progress),
    filterId: `whip-pan-${sceneId.replace(/[^a-zA-Z0-9_-]/g, '-')}-in`,
  };
  return {
    contentStyle: { transform: `scale(${interpolate(progress, [0, 1], [1.25, 1])})`, opacity: progress },
  };
}

function outgoingTransitionVisual(plan: TransitionPlan, progress: number, direction: number, sceneId: string): TransitionVisual {
  if (plan.type === 'whipPan') return {
    contentStyle: { transform: `translateX(${direction * 100 * progress}%)` },
    blurX: 12 * progress,
    filterId: `whip-pan-${sceneId.replace(/[^a-zA-Z0-9_-]/g, '-')}-out`,
  };
  if (plan.type === 'zoomThrough') return {
    contentStyle: { transform: `scale(${interpolate(progress, [0, 1], [1, 1.6])})`, opacity: 1 - progress, filter: `blur(${progress * 4}px)` },
  };
  const intensity = Math.sin(progress * Math.PI);
  if (plan.type === 'lightLeak') {
    const x = 25 + progress * 50;
    return {
      contentStyle: {},
      overlayStyle: { background: `radial-gradient(circle at ${x}% 45%, rgba(255, 184, 72, ${0.62 * intensity}) 0%, rgba(246, 119, 20, ${0.34 * intensity}) 34%, transparent 72%)`, mixBlendMode: 'screen' },
    };
  }
  if (plan.type === 'filmBurn') {
    const x = progress * 140 - 20;
    return {
      contentStyle: { filter: `brightness(${1 + 0.85 * intensity})` },
      overlayStyle: { background: `linear-gradient(110deg, transparent ${x - 28}%, rgba(255, 138, 27, ${0.75 * intensity}) ${x}%, rgba(255, 248, 218, ${0.88 * intensity}) ${x + 18}%, transparent ${x + 46}%)`, mixBlendMode: 'screen' },
    };
  }
  return { contentStyle: {} };
}

function SceneVisual({ scene, realDurationInFrames, visualTiming, boundaryIndex }: {
  scene: RemotionSceneProps;
  realDurationInFrames: number;
  visualTiming: SceneSequenceProps['visualTiming'];
  boundaryIndex: number;
}) {
  const frame = useCurrentFrame();
  const incoming = visualTiming.incomingTransition;
  const outgoing = visualTiming.outgoingTransition;
  const incomingProgress = incoming && incoming.frames > 0 && frame < incoming.frames
    ? interpolate(frame, [0, incoming.frames], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : null;
  const outgoingProgress = outgoing && outgoing.frames > 0 && scene.assetType === 'image' && frame >= realDurationInFrames
    ? interpolate(frame, [realDurationInFrames, realDurationInFrames + outgoing.frames], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : null;
  const incomingDirection = (boundaryIndex - 1) % 2 === 0 ? 1 : -1;
  const outgoingDirection = boundaryIndex % 2 === 0 ? 1 : -1;
  const incomingVisual = incoming && incomingProgress !== null ? incomingTransitionVisual(incoming, incomingProgress, incomingDirection, scene.id) : null;
  const outgoingVisual = outgoing && outgoingProgress !== null ? outgoingTransitionVisual(outgoing, outgoingProgress, outgoingDirection, scene.id) : null;
  const contentStyle: CSSProperties = { ...incomingVisual?.contentStyle, ...outgoingVisual?.contentStyle };
  const overlayStyle = outgoingVisual?.overlayStyle ?? null;
  const filterId = incomingVisual?.filterId ?? outgoingVisual?.filterId ?? null;
  const blurX = incomingVisual?.blurX ?? outgoingVisual?.blurX ?? 0;
  if (filterId) contentStyle.filter = `url(#${filterId})`;
  const hasVisualTransition = (incoming?.frames ?? 0) > 0 || (outgoing?.frames ?? 0) > 0;
  return (
    <AbsoluteFill style={{ backgroundColor: hasVisualTransition ? 'transparent' : 'black' }}>
      {filterId && <svg width="0" height="0" aria-hidden="true"><defs><filter id={filterId} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={`${blurX} 0`} /></filter></defs></svg>}
      <FilmLook
        enabled={scene.filmLook}
        sceneId={scene.id}
        overlay={overlayStyle ? <AbsoluteFill style={overlayStyle} /> : undefined}
      >
        <div style={{ position: 'absolute', inset: 0, ...contentStyle }}>
          {scene.assetType === 'video' ? (
            <OffthreadVideo muted src={staticFile(scene.assetRelPath)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <ImageScene scene={scene} durationInFrames={realDurationInFrames} />
          )}
        </div>
      </FilmLook>
    </AbsoluteFill>
  );
}

export function SceneSequence({ scene, audioTiming, visualTiming, boundaryIndex }: SceneSequenceProps) {
  return (
    <>
      <Sequence from={visualTiming.from} durationInFrames={visualTiming.durationInFrames}>
        <SceneVisual scene={scene} realDurationInFrames={audioTiming.durationInFrames} visualTiming={visualTiming} boundaryIndex={boundaryIndex} />
      </Sequence>
      <Sequence from={audioTiming.from} durationInFrames={audioTiming.durationInFrames}>
        {scene.voiceRelPath ? <Audio src={staticFile(scene.voiceRelPath)} /> : null}
        {scene.sfxRelPath ? <Audio src={staticFile(scene.sfxRelPath)} volume={SFX_VOLUME_NUMBER} /> : null}
        <KeywordOverlay keywords={scene.keywords} />
      </Sequence>
    </>
  );
}
