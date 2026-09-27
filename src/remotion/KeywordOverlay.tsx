import { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { RemotionSceneProps } from '../contracts/video';

const FADE_OUT_SEC = 0.3;
const FONT_FAMILY = 'VideoTool Noto Sans';
const FONT_WEIGHT = '700';
const FONT_STYLE = 'normal';
let fontPromise: Promise<void> | null = null;

function isLoadedLocalFontFace(face: FontFace): boolean {
  return face.family === FONT_FAMILY
    && face.weight === FONT_WEIGHT
    && face.style === FONT_STYLE
    && face.status === 'loaded';
}

function loadLocalFont(): Promise<void> {
  if (!fontPromise) {
    const faces = [
      new FontFace(FONT_FAMILY, `url(${staticFile('fonts/NotoSans-vietnamese.woff2')})`, {
        weight: FONT_WEIGHT,
        style: FONT_STYLE,
        display: 'block',
        unicodeRange: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
      }),
      new FontFace(FONT_FAMILY, `url(${staticFile('fonts/NotoSans-latin.woff2')})`, {
        weight: FONT_WEIGHT,
        style: FONT_STYLE,
        display: 'block',
        unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
      }),
    ];
    fontPromise = Promise.all(faces.map((face) => face.load())).then(async (loadedFaces) => {
      if (!loadedFaces.every(isLoadedLocalFontFace)) throw new Error('A local Noto Sans font face did not load with its expected family, weight, and style.');
      for (const loaded of loadedFaces) document.fonts.add(loaded);
      await document.fonts.ready;
      const registeredFaces = Array.from(document.fonts).filter(isLoadedLocalFontFace);
      if (!loadedFaces.every((face) => document.fonts.has(face)) || registeredFaces.length < loadedFaces.length) {
        throw new Error(`The expected loaded ${FONT_FAMILY} font faces are not registered in document.fonts.`);
      }
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Keyword font ${FONT_FAMILY} failed to load: ${reason}`);
    });
  }
  return fontPromise;
}

function codePoints(text: string): string {
  return Array.from(text).map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
}

function PopUp({ text, durationInFrames }: { text: string; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading local Noto Sans font'));
  useEffect(() => {
    loadLocalFont().then(() => {
      const registeredFaces = Array.from(document.fonts).filter(isLoadedLocalFontFace);
      console.info(`[KeywordOverlay] font=${FONT_FAMILY} loadedFaces=${registeredFaces.length} textCodePoints=${codePoints(text)}`);
      if (registeredFaces.length < 2) throw new Error(`Keyword font ${FONT_FAMILY} is unavailable for popup text.`);
      continueRender(fontHandle);
    }).catch((error) => continueRender(fontHandle, { error }));
  }, [fontHandle, text]);
  const fadeFrames = Math.min(Math.round(FADE_OUT_SEC * fps), durationInFrames);
  const fadeStart = Math.max(0, durationInFrames - fadeFrames);
  const opacityIn = interpolate(frame, [0, Math.max(1, Math.round(0.12 * fps))], [0.12, 1], { extrapolateRight: 'clamp' });
  const opacityOut = interpolate(frame, [fadeStart, Math.max(fadeStart + 1, durationInFrames)], [1, 0], { extrapolateLeft: 'clamp' });
  const scale = spring({ frame, fps, from: 0.6, to: 1, config: { damping: 13, stiffness: 190 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div lang="vi" style={{
        maxWidth: '86%', maxHeight: '30%', overflow: 'hidden',
        color: '#fff', fontFamily: FONT_FAMILY, fontWeight: 700,
        fontSize: Math.min(width * 0.1, height * 0.1), lineHeight: 1.1,
        textAlign: 'center', overflowWrap: 'anywhere',
        display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
        WebkitTextStroke: `${Math.max(2, Math.round(width * 0.003))}px #111`,
        paintOrder: 'stroke fill',
        textShadow: '0 4px 16px rgba(0,0,0,.9), 0 0 32px rgba(0,0,0,.75)',
        opacity: Math.min(opacityIn, opacityOut), transform: `scale(${scale})`,
      }}>
        {text.toLocaleUpperCase('vi')}
      </div>
    </AbsoluteFill>
  );
}

export function KeywordOverlay({ keywords }: { keywords: RemotionSceneProps['keywords'] }) {
  const { fps } = useVideoConfig();
  return <>{keywords.map((keyword, index) => {
    const from = Math.max(0, Math.round(keyword.startSec * fps));
    const end = Math.floor(keyword.endSec * fps);
    const durationInFrames = Math.max(1, end - from);
    return <Sequence key={`${keyword.startSec}-${index}`} from={from} durationInFrames={durationInFrames} layout="none">
      <PopUp text={keyword.text} durationInFrames={durationInFrames} />
    </Sequence>;
  })}</>;
}
