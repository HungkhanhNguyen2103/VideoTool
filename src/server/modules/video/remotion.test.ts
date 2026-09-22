import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  BGM_VOLUME_NUMBER,
  RemotionInputPropsSchema,
  SFX_VOLUME_NUMBER,
} from '../../../contracts/video';
import { loadConfig } from '../../config';
import { sceneDurationInFrames, sceneFrameTimings, totalDurationInFrames } from '../../../remotion/frame-math';

describe('Remotion contracts and frame math', () => {
  it('rounds each scene duration and accumulates frame offsets', () => {
    const scenes = [
      { id: 'one', durationSec: 1.01 },
      { id: 'two', durationSec: 2.49 },
    ];

    expect(sceneDurationInFrames(1.01, 30)).toBe(30);
    expect(sceneDurationInFrames(2.49, 30)).toBe(75);
    expect(sceneFrameTimings(scenes, 30)).toEqual([
      { id: 'one', from: 0, durationInFrames: 30 },
      { id: 'two', from: 30, durationInFrames: 75 },
    ]);
    expect(totalDurationInFrames(scenes, 30)).toBe(105);
  });

  it('accepts only JSON-safe Remotion input props', () => {
    const props = {
      fps: 30,
      width: 1920,
      height: 1080,
      scenes: [
        {
          id: 'scene-1',
          assetType: 'image' as const,
          assetPath: 'renders/r1/scene-1.png',
          audioPath: null,
          sfxPath: null,
          durationSec: 2,
        },
      ],
      bgmPath: null,
    };

    expect(RemotionInputPropsSchema.parse(props)).toEqual(props);
    expect(() =>
      RemotionInputPropsSchema.parse({ ...props, scenes: [{ ...props.scenes[0], assetPath: undefined }] }),
    ).toThrow();
  });

  it('keeps numeric audio volumes exactly aligned with the FFmpeg strings', () => {
    expect(SFX_VOLUME_NUMBER).toBe(0.31622777);
    expect(BGM_VOLUME_NUMBER).toBe(0.1);
  });
});

describe('Remotion build isolation', () => {
  it('keeps the Remotion entry outside server and client build graphs', async () => {
    const [serverTsconfig, clientTsconfig, tsupConfig, viteConfig] = await Promise.all([
      readFile('tsconfig.server.json', 'utf8'),
      readFile('tsconfig.client.json', 'utf8'),
      readFile('tsup.config.ts', 'utf8'),
      readFile('vite.config.ts', 'utf8'),
    ]);

    expect(serverTsconfig).not.toContain('src/remotion');
    expect(clientTsconfig).not.toContain('src/remotion');
    expect(tsupConfig).not.toContain('src/remotion');
    expect(viteConfig).not.toContain('src/remotion');
    expect(loadConfig({ NODE_ENV: 'test' }).REMOTION_PUBLIC_DIR).toBe('./data/remotion-public');
  });
});
