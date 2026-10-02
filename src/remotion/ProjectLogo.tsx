import { AbsoluteFill, Img, staticFile } from 'remotion';
import { LOGO_OPACITY, logoLayout } from './logo-layout';

export function ProjectLogo({ logoRelPath, width, height }: { logoRelPath: string; width: number; height: number }) {
  const layout = logoLayout(width, height);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <Img
        src={staticFile(logoRelPath)}
        style={{
          position: 'absolute',
          right: layout.right,
          bottom: layout.bottom,
          width: layout.width,
          height: layout.height,
          maxWidth: layout.width,
          maxHeight: layout.height,
          objectFit: 'contain',
          opacity: LOGO_OPACITY,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
}
