import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { RemotionKeyword, RemotionSceneProps } from '../contracts/video';
import { formatVietnameseNumber, odometerColumnOffset } from './number-format';

const FADE_OUT_SEC = 0.3;
const COUNT_UP_SEC = 0.7;
const YEAR_ROLL_SEC = 0.8;
const LOWER_THIRD_OUT_SEC = 0.4;
const ROW_EM = 1.1;
export const KEYWORD_FONT_FAMILY = 'VideoToolNotoSans';
const FONT_WEIGHT = '700';
const FONT_STYLE = 'normal';
let fontPromise: Promise<void> | null = null;

function isLoadedLocalFontFace(face: FontFace): boolean {
  return face.family === KEYWORD_FONT_FAMILY
    && face.weight === FONT_WEIGHT
    && face.style === FONT_STYLE
    && face.status === 'loaded';
}

export function loadKeywordFont(): Promise<void> {
  if (!fontPromise) {
    const faces = [
      new FontFace(KEYWORD_FONT_FAMILY, `url(${staticFile('fonts/NotoSans-vietnamese.woff2')})`, {
        weight: FONT_WEIGHT,
        style: FONT_STYLE,
        display: 'block',
        unicodeRange: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
      }),
      new FontFace(KEYWORD_FONT_FAMILY, `url(${staticFile('fonts/NotoSans-latin.woff2')})`, {
        weight: FONT_WEIGHT,
        style: FONT_STYLE,
        display: 'block',
        unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
      }),
    ];
    fontPromise = Promise.all(faces.map((face) => face.load())).then(async (loadedFaces) => {
      if (!loadedFaces.every(isLoadedLocalFontFace)) {
        const descriptors = loadedFaces.map((face) => JSON.stringify({ family: face.family, weight: face.weight, style: face.style, status: face.status })).join(', ');
        throw new Error(`A local Noto Sans font face did not load with its expected family, weight, and style: ${descriptors}`);
      }
      for (const loaded of loadedFaces) document.fonts.add(loaded);
      await document.fonts.ready;
      const registeredFaces = Array.from(document.fonts).filter(isLoadedLocalFontFace);
      if (!loadedFaces.every((face) => document.fonts.has(face)) || registeredFaces.length < loadedFaces.length) {
        throw new Error(`The expected loaded ${KEYWORD_FONT_FAMILY} font faces are not registered in document.fonts.`);
      }
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Keyword font ${KEYWORD_FONT_FAMILY} failed to load: ${reason}`);
    });
  }
  return fontPromise;
}

function codePoints(text: string): string {
  return Array.from(text).map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
}

const upper = (value: string | undefined) => (value ?? '').toLocaleUpperCase('vi');

function progress(frame: number, fps: number, seconds: number, easing: (t: number) => number): number {
  return interpolate(frame, [0, Math.max(1, Math.round(seconds * fps))], [0, 1], {
    easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
}

/** Digits count up from 0; prefix/suffix stay static. Width is reserved for the final value. */
function CountUp({ keyword, frame, fps }: { keyword: RemotionKeyword; frame: number; fps: number }) {
  const decimals = keyword.decimals ?? 0;
  const grouping = keyword.grouping ?? false;
  const finalDigits = formatVietnameseNumber(keyword.value!, decimals, grouping);
  const current = keyword.value! * progress(frame, fps, COUNT_UP_SEC, Easing.out(Easing.cubic));
  return (
    <>
      {keyword.prefix ? `${upper(keyword.prefix)} ` : ''}
      <span style={{ display: 'inline-block', minWidth: `${finalDigits.length}ch`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatVietnameseNumber(current, decimals, grouping)}
      </span>
      {keyword.suffix ? ` ${upper(keyword.suffix)}` : ''}
    </>
  );
}

function OdometerDigit({ value, column }: { value: number; column: number }) {
  const offset = odometerColumnOffset(value, column);
  return (
    <span style={{ display: 'inline-block', height: `${ROW_EM}em`, overflow: 'hidden', verticalAlign: 'top' }}>
      <span style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${-offset * ROW_EM}em)` }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit, index) => (
          <span key={index} style={{ height: `${ROW_EM}em`, lineHeight: ROW_EM }}>{digit}</span>
        ))}
      </span>
    </span>
  );
}

/** Year rolls like an odometer from fromYear; a marker slides along the project timeline in sync. */
function YearRoll({ keyword, frame, fps, fontSize, width }: { keyword: RemotionKeyword; frame: number; fps: number; fontSize: number; width: number }) {
  const to = keyword.year!;
  const from = keyword.fromYear ?? to;
  const value = from + (to - from) * progress(frame, fps, YEAR_ROLL_SEC, Easing.inOut(Easing.cubic));
  const columns = Math.max(4, String(Math.max(from, to)).length);
  const timeline = keyword.timeline;
  const markerPosition = timeline ? Math.min(1, Math.max(0, (value - timeline.min) / (timeline.max - timeline.min))) : null;
  const lineWidth = Math.min(width * 0.5, fontSize * 6);
  const labelStyle: CSSProperties = {
    position: 'absolute', top: fontSize * 0.14, fontSize: fontSize * 0.22, opacity: 0.8,
    WebkitTextStroke: '1px #111', textShadow: '0 2px 6px rgba(0,0,0,.9)',
  };
  return (
    <div>
      <div style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {Array.from({ length: columns }, (_, index) => <OdometerDigit key={index} value={value} column={columns - 1 - index} />)}
      </div>
      {timeline && markerPosition !== null && (
        <div style={{ position: 'relative', width: lineWidth, height: fontSize * 0.5, margin: `${fontSize * 0.18}px auto 0` }}>
          <div style={{
            position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(2, Math.round(fontSize * 0.03)),
            background: 'rgba(255,255,255,.7)', borderRadius: 999, boxShadow: '0 1px 5px rgba(0,0,0,.95)',
          }} />
          <div style={{
            position: 'absolute', top: 0, left: `${markerPosition * 100}%`, width: fontSize * 0.16, height: fontSize * 0.16,
            transform: 'translate(-50%, -40%)', borderRadius: '50%', background: '#fff', boxShadow: '0 0 12px rgba(0,0,0,.8)',
          }} />
          <span style={{ ...labelStyle, left: 0 }}>{timeline.min}</span>
          <span style={{ ...labelStyle, right: 0 }}>{timeline.max}</span>
        </div>
      )}
    </div>
  );
}

function MapPinIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" stroke="#f5a623" strokeWidth="1.8" />
      <circle cx="12" cy="9" r="2.2" stroke="#f5a623" strokeWidth="1.8" />
    </svg>
  );
}

function LowerThird({ keyword, frame, fps, width, height, durationInFrames }: {
  keyword: RemotionKeyword;
  frame: number;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
}) {
  const enter = spring({ frame, fps, from: 0, to: 1, config: { damping: 15, stiffness: 170 } });
  const outFrames = Math.max(1, Math.round(LOWER_THIRD_OUT_SEC * fps));
  const outStart = Math.max(0, durationInFrames - outFrames);
  const out = interpolate(frame, [outStart, Math.max(outStart + 1, durationInFrames)], [0, 1], {
    easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const opacityIn = interpolate(frame, [0, Math.max(1, Math.round(0.18 * fps))], [0, 1], { extrapolateRight: 'clamp' });
  const opacity = Math.min(opacityIn, 1 - out);
  const translateX = ((1 - enter) * -110) + (out * -110);
  const marginBottom = width / height < 0.8 ? 0.14 : 0.1;
  const nameSize = Math.min(width, height) * 0.045;
  const pinSize = nameSize * 0.72;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: width * 0.06, bottom: height * marginBottom, maxWidth: width * 0.82,
        opacity, transform: `translateX(${translateX}%)`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'stretch', overflow: 'hidden', borderRadius: 5,
          background: 'rgba(10,14,28,.78)', boxShadow: '0 5px 18px rgba(0,0,0,.42)',
        }}>
          <div style={{ width: Math.max(4, Math.round(width * 0.003)), background: '#f5a623', flex: '0 0 auto' }} />
          <div style={{ padding: `${nameSize * 0.22}px ${nameSize * 0.48}px ${nameSize * 0.24}px` }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: nameSize * 0.14, color: '#fff',
              fontFamily: KEYWORD_FONT_FAMILY, fontWeight: 700, fontSize: nameSize, lineHeight: 1.05,
              whiteSpace: 'nowrap', textShadow: '0 2px 7px rgba(0,0,0,.75)',
            }}>
              {keyword.nameRole === 'place' ? <MapPinIcon size={pinSize} /> : null}
              <span>{keyword.text}</span>
            </div>
            {keyword.subtitle ? (
              <div style={{
                marginTop: nameSize * 0.12, color: 'rgba(255,255,255,.8)', fontFamily: KEYWORD_FONT_FAMILY,
                fontSize: nameSize * 0.6, lineHeight: 1.05, textShadow: '0 1px 5px rgba(0,0,0,.75)',
              }}>{keyword.subtitle}</div>
            ) : null}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function PopUp({ keyword, durationInFrames }: { keyword: RemotionKeyword; durationInFrames: number }) {
  const { text } = keyword;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading local Noto Sans font'));
  useEffect(() => {
    loadKeywordFont().then(() => {
      const registeredFaces = Array.from(document.fonts).filter(isLoadedLocalFontFace);
      console.info(`[KeywordOverlay] font=${KEYWORD_FONT_FAMILY} loadedFaces=${registeredFaces.length} textCodePoints=${codePoints(text)}`);
      if (registeredFaces.length < 2) throw new Error(`Keyword font ${KEYWORD_FONT_FAMILY} is unavailable for popup text.`);
      continueRender(fontHandle);
    }).catch((error) => cancelRender(error));
  }, [fontHandle, text]);
  const fadeFrames = Math.min(Math.round(FADE_OUT_SEC * fps), durationInFrames);
  const fadeStart = Math.max(0, durationInFrames - fadeFrames);
  const opacityIn = interpolate(frame, [0, Math.max(1, Math.round(0.12 * fps))], [0.12, 1], { extrapolateRight: 'clamp' });
  const opacityOut = interpolate(frame, [fadeStart, Math.max(fadeStart + 1, durationInFrames)], [1, 0], { extrapolateLeft: 'clamp' });
  const scale = spring({ frame, fps, from: 0.6, to: 1, config: { damping: 13, stiffness: 190 } });
  const fontSize = Math.min(width * 0.1, height * 0.1);
  const base: CSSProperties = {
    color: '#fff', fontFamily: KEYWORD_FONT_FAMILY, fontWeight: 700, fontSize, lineHeight: ROW_EM, textAlign: 'center',
    WebkitTextStroke: `${Math.max(2, Math.round(width * 0.003))}px #111`,
    paintOrder: 'stroke fill',
    textShadow: '0 4px 16px rgba(0,0,0,.9), 0 0 32px rgba(0,0,0,.75)',
    opacity: Math.min(opacityIn, opacityOut), transform: `scale(${scale})`,
  };
  const isYear = keyword.kind === 'year' && keyword.year !== undefined;
  const isCount = keyword.kind === 'number' && keyword.value !== undefined;
  if (keyword.kind === 'name') {
    return <LowerThird keyword={keyword} frame={frame} fps={fps} width={width} height={height} durationInFrames={durationInFrames} />;
  }
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      {isYear ? (
        <div lang="vi" style={base}><YearRoll keyword={keyword} frame={frame} fps={fps} fontSize={fontSize} width={width} /></div>
      ) : (
        <div lang="vi" style={{
          ...base, maxWidth: '86%', maxHeight: '30%', overflow: 'hidden', overflowWrap: 'anywhere',
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
        }}>
          {isCount ? <CountUp keyword={keyword} frame={frame} fps={fps} /> : upper(text)}
        </div>
      )}
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
      <PopUp keyword={keyword} durationInFrames={durationInFrames} />
    </Sequence>;
  })}</>;
}
