import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

export const FILM_LOOK_SEPIA = 0.35;
export const FILM_LOOK_SATURATION = 0.8;
export const FILM_LOOK_CONTRAST = 1.05;
export const FILM_LOOK_BRIGHTNESS = 0.97;
export const FILM_LOOK_VIGNETTE_EDGE_ALPHA = 0.34;
export const FILM_LOOK_VIGNETTE_START = 55;
export const FILM_LOOK_GRAIN_OPACITY = 0.08;
export const FILM_LOOK_GRAIN_TILE_SIZE = 128;
export const FILM_LOOK_GRAIN_FRAME_HOLD = 2;
export const FILM_LOOK_FLICKER_AMOUNT = 0.02;
export const FILM_LOOK_FLICKER_SPEED = 0.73;

function hashString(value: string): number {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

function hashFrame(sceneHash: number, frame: number, salt: number): number {
  let hash = sceneHash ^ Math.imul(frame + 1, 0x9e3779b9) ^ salt;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  return (Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) ^ (hash >>> 16)) >>> 0;
}

export const FILM_LOOK_GRAIN_TILE_DATA_URL = 'data:image/png;base64,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';

export function FilmLook({ enabled, sceneId, children, overlay }: { enabled: boolean; sceneId: string; children: ReactNode; overlay?: ReactNode }) {
  const frame = useCurrentFrame();
  if (!enabled) return <>{children}{overlay}</>;

  const sceneHash = hashString(sceneId);
  const phase = sceneHash * 0.0001;
  const flicker = Math.sin(frame * FILM_LOOK_FLICKER_SPEED + phase) * FILM_LOOK_FLICKER_AMOUNT;
  const grainFrame = Math.floor(frame / FILM_LOOK_GRAIN_FRAME_HOLD);
  const grainX = hashFrame(sceneHash, grainFrame, 0x13579bdf) % FILM_LOOK_GRAIN_TILE_SIZE;
  const grainY = hashFrame(sceneHash, grainFrame, 0x2468ace0) % FILM_LOOK_GRAIN_TILE_SIZE;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ filter: `sepia(${FILM_LOOK_SEPIA}) saturate(${FILM_LOOK_SATURATION}) contrast(${FILM_LOOK_CONTRAST}) brightness(${FILM_LOOK_BRIGHTNESS})` }}>
        {children}
      </AbsoluteFill>
      {overlay}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent ${FILM_LOOK_VIGNETTE_START}%, rgba(0, 0, 0, ${FILM_LOOK_VIGNETTE_EDGE_ALPHA}) 100%)`, pointerEvents: 'none' }} />
      <AbsoluteFill aria-hidden="true" style={{ background: flicker >= 0 ? '#fff' : '#000', opacity: Math.abs(flicker), pointerEvents: 'none' }} />
      <AbsoluteFill aria-hidden="true" style={{ backgroundImage: `url("${FILM_LOOK_GRAIN_TILE_DATA_URL}")`, backgroundSize: `${FILM_LOOK_GRAIN_TILE_SIZE}px ${FILM_LOOK_GRAIN_TILE_SIZE}px`, backgroundPosition: `${grainX}px ${grainY}px`, opacity: FILM_LOOK_GRAIN_OPACITY, pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
}
