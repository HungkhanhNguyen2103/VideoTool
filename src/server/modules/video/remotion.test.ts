import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BGM_VOLUME_NUMBER,
  RemotionInputPropsSchema,
  SFX_VOLUME_NUMBER,
} from '../../../contracts/video';
import { loadConfig } from '../../config';
import { sceneDurationInFrames, sceneFrameTimings, totalDurationInFrames } from '../../../remotion/frame-math';
import { buildRemotionInputProps } from './remotion-props';
import { stageRemotionRender } from './remotion-staging';
import { RemotionRenderer } from './remotion-renderer';
import { configureRemotionBundle, getRemotionBundle } from './remotion-bundle';

const remotionBundlerMock = vi.hoisted(() => ({ bundle: vi.fn() }));
vi.mock('@remotion/bundler', () => remotionBundlerMock);

describe('Remotion contracts and frame math', () => {
  it('rounds each scene duration and accumulates frame offsets', () => {
    const scenes = [
      { id: 'one', durationSec: 1.01 },
      { id: 'two', durationSec: 1.01 },
    ];

    expect(sceneDurationInFrames(1.01, 30)).toBe(30);
    expect(sceneDurationInFrames(1.01, 30)).toBe(30);
    expect(sceneFrameTimings(scenes, 30)).toEqual([
      { id: 'one', from: 0, durationInFrames: 30 },
      { id: 'two', from: 30, durationInFrames: 30 },
    ]);
    expect(totalDurationInFrames(scenes, 30)).toBe(61);
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
          assetRelPath: 'renders/r1/scene-1.png',
          voiceRelPath: null,
          sfxRelPath: null,
          durationSec: 2,
        },
      ],
      bgmRelPath: null,
    };

    expect(RemotionInputPropsSchema.parse(props)).toEqual(props);
    expect(() =>
      RemotionInputPropsSchema.parse({ ...props, scenes: [{ ...props.scenes[0], assetRelPath: undefined }] }),
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

describe('Remotion props and public-dir staging', () => {
  it('resolves owned media and produces generated forward-slash paths', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'remotion-props-'));
    try {
      const sources = new Map([
        ['asset-1', { absolutePath: path.join(directory, 'source.png'), mimeType: 'image/png', purpose: 'reference' as const }],
        ['voice-1', { absolutePath: path.join(directory, 'voice.wav'), mimeType: 'audio/wav', purpose: 'voiceover' as const }],
        ['sfx-1', { absolutePath: path.join(directory, 'sfx.mp3'), mimeType: 'audio/mpeg', purpose: 'sfx' as const }],
        ['bgm-1', { absolutePath: path.join(directory, 'bgm.mp3'), mimeType: 'audio/mpeg', purpose: 'bgm' as const }],
      ]);
      const resolver = vi.fn(async (projectId: string, fileId: string) => {
        expect(projectId).toBe('project-1');
        const source = sources.get(fileId);
        if (!source) throw new Error(`missing ${fileId}`);
        return source;
      });
      const project = {
        id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: 'bgm-1',
      } as never;
      const scenes = [{ id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: 'voice-1', sfxFileId: 'sfx-1', durationSec: 2 }] as never;

      const props = await buildRemotionInputProps(project, scenes, 'render-1', resolver);

      expect(props).toMatchObject({
        bgmRelPath: 'renders/render-1/bgm.mp3',
        scenes: [{ assetRelPath: 'renders/render-1/scene-01-asset.png', voiceRelPath: 'renders/render-1/scene-01-voice.wav', sfxRelPath: 'renders/render-1/scene-01-sfx.mp3' }],
      });
      expect(resolver).toHaveBeenCalledWith('project-1', 'asset-1');
      expect(resolver).toHaveBeenCalledWith('project-1', 'voice-1');
      expect(resolver).toHaveBeenCalledWith('project-1', 'sfx-1');
      expect(resolver).toHaveBeenCalledWith('project-1', 'bgm-1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('copies generated media into the bundle public directory and cleans it up', async () => {
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'remotion-stage-source-'));
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'remotion-stage-bundle-'));
    try {
      await writeFile(path.join(sourceDir, 'image.png'), 'image');
      const resolver = async (_projectId: string, fileId: string) => ({
        absolutePath: path.join(sourceDir, fileId === 'asset-1' ? 'image.png' : 'bgm.mp3'),
        mimeType: fileId === 'asset-1' ? 'image/png' : 'audio/mpeg',
        purpose: fileId === 'asset-1' ? 'reference' as const : 'bgm' as const,
      });
      const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null } as never;
      const scenes = [{ id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxFileId: null, durationSec: 1 }] as never;

      const staged = await stageRemotionRender({ serveUrl: bundleDir, project, scenes, renderId: 'render-1', resolver });
      const stagedPath = path.join(bundleDir, 'public', 'renders', 'render-1', 'scene-01-asset.png');
      expect(await readFile(stagedPath, 'utf8')).toBe('image');
      expect(staged.inputProps.scenes[0]?.assetRelPath).toBe('renders/render-1/scene-01-asset.png');
      await staged.cleanup();
      await expect(readdir(path.dirname(stagedPath))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });

  it('rejects purpose or MIME mismatches before copying', async () => {
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'remotion-invalid-source-'));
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'remotion-invalid-bundle-'));
    try {
      await writeFile(path.join(sourceDir, 'not-image.mp3'), 'audio');
      const resolver = async () => ({ absolutePath: path.join(sourceDir, 'not-image.mp3'), mimeType: 'audio/mpeg', purpose: 'sfx' as const });
      const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null } as never;
      const scenes = [{ id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxFileId: null, durationSec: 1 }] as never;

      await expect(stageRemotionRender({ serveUrl: bundleDir, project, scenes, renderId: 'render-1', resolver })).rejects.toMatchObject({ code: 'INVALID_RENDER_ASSET' });
      await expect(readdir(path.join(bundleDir, 'public', 'renders'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });
});

describe('Remotion renderer orchestration', () => {
  it('shares one bundle promise, passes identical props, logs progress, and cleans on render failure', async () => {
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'remotion-render-source-'));
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'remotion-render-bundle-'));
    try {
      await writeFile(path.join(sourceDir, 'image.png'), 'image');
      const resolver = async () => ({ absolutePath: path.join(sourceDir, 'image.png'), mimeType: 'image/png', purpose: 'reference' as const });
      const bundle = vi.fn().mockResolvedValue(bundleDir);
      const selectComposition = vi.fn().mockResolvedValue({ id: 'VideoComposition', width: 1920, height: 1080, fps: 30, durationInFrames: 30 });
      const renderMedia = vi.fn().mockRejectedValue(new Error('browser failed'));
      const renderer = new RemotionRenderer({ resolver, bundle, selectComposition, renderMedia });
      const scene = { id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxFileId: null, durationSec: 1 } as never;
      const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null, scenes: [scene] } as never;
      const logs: string[] = [];

      await expect(renderer.renderScenePreview(project, scene)).rejects.toMatchObject({ code: 'REMOTION_RENDER_FAILED', status: 502 });
      await expect(renderer.renderFullVideo(project, async (message) => { logs.push(message); })).rejects.toMatchObject({ code: 'REMOTION_RENDER_FAILED', status: 502 });

      expect(bundle).toHaveBeenCalledOnce();
      expect(selectComposition).toHaveBeenCalled();
      expect(renderMedia).toHaveBeenCalled();
      expect(selectComposition.mock.calls[0]?.[0].inputProps).toEqual(renderMedia.mock.calls[0]?.[0].inputProps);
      expect(logs.some((message) => message.includes('render'))).toBe(true);
      expect(await readdir(path.join(bundleDir, 'public', 'renders'))).toHaveLength(0);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });
});

describe('Remotion bundle lifecycle', () => {
  it('caches a successful bundle and retries after a rejection or configuration change', async () => {
    const dirOne = await mkdtemp(path.join(tmpdir(), 'remotion-bundle-one-'));
    const dirTwo = await mkdtemp(path.join(tmpdir(), 'remotion-bundle-two-'));
    remotionBundlerMock.bundle.mockReset().mockResolvedValue('C:/bundle-one');
    try {
      configureRemotionBundle(dirOne);
      await expect(getRemotionBundle()).resolves.toBe('C:\\bundle-one');
      await expect(getRemotionBundle()).resolves.toBe('C:\\bundle-one');
      expect(remotionBundlerMock.bundle).toHaveBeenCalledOnce();

      configureRemotionBundle(dirTwo);
      remotionBundlerMock.bundle.mockRejectedValueOnce(new Error('bundle failed'));
      await expect(getRemotionBundle()).rejects.toThrow('bundle failed');
      remotionBundlerMock.bundle.mockResolvedValueOnce('C:/bundle-two');
      await expect(getRemotionBundle()).resolves.toBe('C:\\bundle-two');
      expect(remotionBundlerMock.bundle).toHaveBeenCalledTimes(3);
    } finally {
      await rm(dirOne, { recursive: true, force: true });
      await rm(dirTwo, { recursive: true, force: true });
    }
  });
});
