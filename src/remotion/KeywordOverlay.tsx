import { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { RemotionSceneProps } from '../contracts/video';

const FADE_OUT_SEC = 0.3;
const FONT_FAMILY = 'Be Vietnam Pro';
const FONT_CHECK_TEXT = 'Ả Ẻ Ỏ Ủ Ỷ Ố Ờ Ự Đ';
let fontPromise: Promise<void> | null = null;

function loadLocalFont(): Promise<void> {
  if (!fontPromise) {
    const face = new FontFace(FONT_FAMILY, `url(${staticFile('fonts/BeVietnamPro-Bold.ttf')})`, { weight: '700', style: 'normal', display: 'block' });
    fontPromise = face.load().then(async (loaded) => {
      if (loaded.status !== 'loaded') throw new Error(`FontFace status is ${loaded.status}.`);
      document.fonts.add(loaded);
      await document.fonts.ready;
      const fontApplied = document.fonts.check(`700 100px "${FONT_FAMILY}"`, FONT_CHECK_TEXT);
      if (!fontApplied) throw new Error(`document.fonts.check() did not confirm ${FONT_FAMILY}.`);
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
  const [fontHandle] = useState(() => delayRender('Loading local Be Vietnam Pro font'));
  useEffect(() => {
    loadLocalFont().then(() => {
      const fontApplied = document.fonts.check(`700 100px "${FONT_FAMILY}"`, text);
      console.info(`[KeywordOverlay] font=${FONT_FAMILY} applied=${fontApplied} textCodePoints=${codePoints(text)}`);
      if (!fontApplied) throw new Error(`Keyword font ${FONT_FAMILY} is unavailable for popup text.`);
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
      <div style={{
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
