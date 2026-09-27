import { useEffect, useState } from 'react';
import { AbsoluteFill, cancelRender, Composition, continueRender, delayRender, registerRoot } from 'remotion';
import { KEYWORD_FONT_FAMILY, loadKeywordFont } from '../../src/remotion/KeywordOverlay';

const GLYPH_SAMPLE = 'Ả Ẻ Ỏ Ủ Ỷ Ố Ờ Ự Đ';

function FontSample({ useKeywordFont }: { useKeywordFont: boolean }) {
  const [fontHandle] = useState(() => useKeywordFont ? delayRender('Loading keyword font for verification') : null);

  useEffect(() => {
    if (fontHandle === null) return;
    loadKeywordFont()
      .then(() => continueRender(fontHandle))
      .catch((error) => cancelRender(error));
  }, [fontHandle]);

  return (
    <AbsoluteFill style={{ alignItems: 'center', backgroundColor: '#fff', justifyContent: 'center' }}>
      <div lang="vi" style={{
        color: '#000',
        fontFamily: useKeywordFont ? KEYWORD_FONT_FAMILY : 'NoSuchFont',
        fontSize: 144,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        {GLYPH_SAMPLE}
      </div>
    </AbsoluteFill>
  );
}

function FontVerificationRoot() {
  return (
    <>
      <Composition id="KeywordFontReal" component={() => <FontSample useKeywordFont />} width={1920} height={1080} fps={30} durationInFrames={1} />
      <Composition id="KeywordFontBogus" component={() => <FontSample useKeywordFont={false} />} width={1920} height={1080} fps={30} durationInFrames={1} />
    </>
  );
}

registerRoot(FontVerificationRoot);
