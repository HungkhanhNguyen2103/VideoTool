import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
import { ensureBrowser } from '@remotion/renderer';
import type { RenderMediaOptions } from '@remotion/renderer';
import type { BundleOptions } from '@remotion/bundler';
import type { Scene } from '../../../contracts/project';

const renderResourceLock = path.join(tmpdir(), 'video-tool-render-resource.lock');

async function acquireRenderResourceLock(): Promise<() => Promise<void>> {
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(renderResourceLock, 'wx');
      return async () => { await handle.close(); await rm(renderResourceLock, { force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() - started > 120_000) throw new Error('Timed out waiting for the render resource lock.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}


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

    expect(RemotionInputPropsSchema.parse(props)).toEqual({ ...props, transitionStyle: 'varied', parallax: 'off', scenes: [{ ...props.scenes[0], videoKeyframeRelPath: null, videoTailRelPath: null, videoDurationSec: null, depthMapRelPath: null, filmLook: false, keywords: [] }] });
    expect(() =>
      RemotionInputPropsSchema.parse({ ...props, scenes: [{ ...props.scenes[0], assetRelPath: undefined }] }),
    ).toThrow();
  });

  it('keeps numeric audio volumes exactly aligned with the FFmpeg strings', () => {
    expect(SFX_VOLUME_NUMBER).toBe(0.31622777);
    expect(BGM_VOLUME_NUMBER).toBe(0.1);
  });

  it('mutes embedded audio from source video scenes', async () => {
    const source = await readFile('src/remotion/SceneSequence.tsx', 'utf8');
    expect(source).toMatch(/<OffthreadVideo[\s\S]*muted/);
  });

  it('uses the video tail frame before falling back to the keyframe', async () => {
    const source = await readFile('src/remotion/SceneSequence.tsx', 'utf8');
    expect(source).toContain('const trailing = scene.videoTailRelPath ?? scene.videoKeyframeRelPath;');
    expect(source).toContain('hasKeyframe: Boolean(trailing)');
    expect(source).toContain('staticFile(trailing)');
  });

  it('uses a horizontal-only SVG blur for whip-pan transitions', async () => {
    const source = await readFile('src/remotion/SceneSequence.tsx', 'utf8');
    expect(source).toContain('feGaussianBlur');
    expect(source).toContain('stdDeviation={`${blurX} 0`}');
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
  it('passes only timings bound to the current voiceover into Remotion', async () => {
    const resolver = async (_projectId: string, fileId: string) => ({
      absolutePath: path.join(tmpdir(), fileId === 'asset-1' ? 'image.png' : 'voice.wav'),
      mimeType: fileId === 'asset-1' ? 'image/png' : 'audio/wav',
      purpose: fileId === 'asset-1' ? 'reference' as const : 'voiceover' as const,
    });
    const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: true } as never;
    const scene = {
      id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: 'voice-1', sfxFileId: null, durationSec: 4,
      wordTimings: { audioFileId: 'voice-1', words: [
        { text: 'giá', startSec: 0, endSec: .3 }, { text: '30', startSec: 1, endSec: 1.2 },
        { text: 'tỷ', startSec: 1.2, endSec: 1.4 }, { text: 'rồi', startSec: 2.8, endSec: 3 },
      ] },
    } as unknown as Scene;
    const current = await buildRemotionInputProps(project, [scene], 'render-current', resolver);
    expect(current.transitionStyle).toBe('varied');
    expect(current.scenes[0]?.keywords).toMatchObject([{ text: '30 tỷ', startSec: 1, endSec: 2.5 }]);
    const stale = await buildRemotionInputProps(project, [{ ...scene, audioFileId: 'voice-2' }], 'render-stale', resolver);
    expect(stale.scenes[0]?.keywords).toEqual([]);
  });

  it('omits every keyword when project pop-ups are disabled', async () => {
    const resolver = async (_projectId: string, fileId: string) => ({
      absolutePath: path.join(tmpdir(), fileId === 'asset-1' ? 'image.png' : 'voice.wav'),
      mimeType: fileId === 'asset-1' ? 'image/png' : 'audio/wav',
      purpose: fileId === 'asset-1' ? 'reference' as const : 'voiceover' as const,
    });
    const project = {
      id: 'project-1', renderSettings: { aspect: '16:9' as const, fps: 30 as const, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: false,
    } as const;
    const timedScene = {
      id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: 'voice-1', sfxFileId: null, durationSec: 4,
      wordTimings: { audioFileId: 'voice-1', words: [
        { text: 'giá', startSec: 0, endSec: .3 }, { text: '30', startSec: 1, endSec: 1.2 }, { text: 'tỷ', startSec: 1.2, endSec: 1.4 },
        { text: 'Steven', startSec: 2, endSec: 2.2 }, { text: 'Sasson', startSec: 2.2, endSec: 2.4 },
      ] },
    } as unknown as Scene;

    const props = await buildRemotionInputProps(project, [timedScene, { ...timedScene, id: 'scene-2' }], 'render-disabled', resolver);

    expect(props.scenes.map((scene) => scene.keywords)).toEqual([[], []]);
  });

  it('computes film look from years even when project pop-ups are disabled', async () => {
    const resolver = async (_projectId: string, fileId: string) => ({
      absolutePath: path.join(tmpdir(), fileId === 'asset-1' ? 'image.png' : 'voice.wav'),
      mimeType: fileId === 'asset-1' ? 'image/png' : 'audio/wav',
      purpose: fileId === 'asset-1' ? 'reference' as const : 'voiceover' as const,
    });
    const project = {
      id: 'project-1', renderSettings: { aspect: '16:9' as const, fps: 30 as const, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: false,
      filmLook: 'auto' as const,
    };
    const makeScene = (id: string, text: string) => ({
      id, assetType: 'image', assetFileId: 'asset-1', audioFileId: 'voice-1', sfxFileId: null, durationSec: 4,
      wordTimings: { audioFileId: 'voice-1', words: [{ text, startSec: 0, endSec: .2 }, { text: 'xong', startSec: 2, endSec: 2.2 }] },
    }) as unknown as Scene;

    const props = await buildRemotionInputProps(project, [makeScene('scene-1', '1975'), makeScene('scene-2', '2012')], 'render-disabled-film', resolver);

    expect(props.scenes.map((scene) => scene.keywords)).toEqual([[], []]);
    expect(props.scenes.map((scene) => scene.filmLook)).toEqual([true, false]);
  });

  it('keeps legacy projects with no toggle field enabled', async () => {
    const resolver = async (_projectId: string, fileId: string) => ({
      absolutePath: path.join(tmpdir(), fileId === 'asset-1' ? 'image.png' : 'voice.wav'),
      mimeType: fileId === 'asset-1' ? 'image/png' : 'audio/wav',
      purpose: fileId === 'asset-1' ? 'reference' as const : 'voiceover' as const,
    });
    const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null } as never;
    const timedScene = {
      id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: 'voice-1', sfxFileId: null, durationSec: 4,
      wordTimings: { audioFileId: 'voice-1', words: [{ text: '30', startSec: 1, endSec: 1.2 }, { text: 'tỷ', startSec: 1.2, endSec: 1.4 }] },
    } as unknown as Scene;

    const props = await buildRemotionInputProps(project, [timedScene], 'render-legacy-toggle', resolver);

    expect(props.scenes[0]?.keywords).toMatchObject([{ text: '30 tỷ', kind: 'number', value: 30 }]);
    expect(props.scenes[0]?.filmLook).toBe(false);
  });

  it('stages only an eligible matching depth map when parallax is enabled', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'remotion-depth-'));
    try {
      const sources = new Map([
        ['asset-1', { absolutePath: path.join(directory, 'image.png'), mimeType: 'image/png', purpose: 'reference' as const }],
        ['depth-1', { absolutePath: path.join(directory, 'depth.png'), mimeType: 'image/png', purpose: 'depth' as const }],
      ]);
      const resolver = vi.fn(async (_projectId: string, fileId: string) => sources.get(fileId)!);
      const project = { id: 'project-1', renderSettings: { aspect: '16:9' as const, fps: 30 as const, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: true, parallax: 'auto' as const };
      const scene = { id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', depthMap: { assetFileId: 'asset-1', fileId: 'depth-1', score: 0.95 }, audioFileId: null, sfxFileId: null, durationSec: 2 } as unknown as Scene;
      const props = await buildRemotionInputProps(project, [scene], 'render-depth', resolver);
      expect(props.parallax).toBe('auto');
      expect(props.scenes[0]?.depthMapRelPath).toBe('renders/render-depth/scene-01-depth.png');
      expect(resolver).toHaveBeenCalledWith('project-1', 'depth-1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stages a video scene keyframe image alongside the video asset', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'remotion-keyframe-'));
    try {
      const sources = new Map([
        ['video-1', { absolutePath: path.join(directory, 'scene.mp4'), mimeType: 'video/mp4', purpose: 'reference' as const }],
        ['keyframe-1', { absolutePath: path.join(directory, 'keyframe.png'), mimeType: 'image/png', purpose: 'reference' as const }],
      ]);
      const resolver = vi.fn(async (_projectId: string, fileId: string) => sources.get(fileId)!);
      const project = { id: 'project-1', renderSettings: { aspect: '16:9' as const, fps: 30 as const, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: true };
      const scene = { id: 'scene-1', assetType: 'video', assetFileId: 'video-1', videoKeyframeFileId: 'keyframe-1', videoDurationSec: 1.2, audioFileId: null, sfxFileId: null, durationSec: 4 } as unknown as Scene;

      const props = await buildRemotionInputProps(project, [scene], 'render-keyframe', resolver);

      expect(props.scenes[0]).toMatchObject({ assetType: 'video', videoKeyframeRelPath: 'renders/render-keyframe/scene-01-keyframe.png', videoTailRelPath: null, videoDurationSec: 1.2 });
      expect(resolver).toHaveBeenCalledWith('project-1', 'keyframe-1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('prefers and stages a video tail frame alongside the keyframe', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'remotion-tail-'));
    try {
      const sources = new Map([
        ['video-1', { absolutePath: path.join(directory, 'scene.mp4'), mimeType: 'video/mp4', purpose: 'reference' as const }],
        ['keyframe-1', { absolutePath: path.join(directory, 'keyframe.png'), mimeType: 'image/png', purpose: 'reference' as const }],
        ['tail-1', { absolutePath: path.join(directory, 'tail.png'), mimeType: 'image/png', purpose: 'reference' as const }],
      ]);
      const resolver = vi.fn(async (_projectId: string, fileId: string) => sources.get(fileId)!);
      const project = { id: 'project-1', renderSettings: { aspect: '16:9' as const, fps: 30 as const, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: true };
      const scene = { id: 'scene-1', assetType: 'video', assetFileId: 'video-1', videoKeyframeFileId: 'keyframe-1', videoTailFileId: 'tail-1', videoDurationSec: 1.2, audioFileId: null, sfxFileId: null, durationSec: 4 } as unknown as Scene;

      const props = await buildRemotionInputProps(project, [scene], 'render-tail', resolver);

      expect(props.scenes[0]).toMatchObject({ videoKeyframeRelPath: 'renders/render-tail/scene-01-keyframe.png', videoTailRelPath: 'renders/render-tail/scene-01-tail.png' });
      expect(resolver).toHaveBeenCalledWith('project-1', 'tail-1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('falls back to the keyframe when the video tail cannot be resolved', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'remotion-tail-fallback-'));
    try {
      const resolver = vi.fn(async (_projectId: string, fileId: string) => {
        if (fileId === 'tail-1') throw new Error('missing tail');
        return { absolutePath: path.join(directory, fileId === 'video-1' ? 'scene.mp4' : 'keyframe.png'), mimeType: fileId === 'video-1' ? 'video/mp4' : 'image/png', purpose: 'reference' as const };
      });
      const project = { id: 'project-1', renderSettings: { aspect: '16:9' as const, fps: 30 as const, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: true };
      const scene = { id: 'scene-1', assetType: 'video', assetFileId: 'video-1', videoKeyframeFileId: 'keyframe-1', videoTailFileId: 'tail-1', videoDurationSec: 1.2, audioFileId: null, sfxFileId: null, durationSec: 4 } as unknown as Scene;

      await expect(buildRemotionInputProps(project, [scene], 'render-tail-fallback', resolver)).resolves.toMatchObject({ scenes: [{ videoKeyframeRelPath: 'renders/render-tail-fallback/scene-01-keyframe.png', videoTailRelPath: null }] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ignores a tail reference on an image scene', async () => {
    const resolver = vi.fn(async () => ({ absolutePath: path.join(tmpdir(), 'image.png'), mimeType: 'image/png', purpose: 'reference' as const }));
    const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: true } as never;
    const scene = { id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', videoTailFileId: 'tail-1', audioFileId: null, sfxFileId: null, durationSec: 2 } as unknown as Scene;

    const props = await buildRemotionInputProps(project, [scene], 'render-image-tail', resolver);

    expect(props.scenes[0]?.videoTailRelPath).toBeNull();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('uses full project scene order for year context when staging a single-scene preview', async () => {
    const resolver = async (_projectId: string, fileId: string) => ({
      absolutePath: path.join(tmpdir(), fileId === 'asset-1' ? 'image.png' : 'voice.wav'),
      mimeType: fileId === 'asset-1' ? 'image/png' : 'audio/wav',
      purpose: fileId === 'asset-1' ? 'reference' as const : 'voiceover' as const,
    });
    const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null, keywordPopupsEnabled: true } as never;
    const earlier = { id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: 'voice-1', sfxFileId: null, durationSec: 4, wordTimings: { audioFileId: 'voice-1', words: [{ text: 'năm', startSec: 0, endSec: .2 }, { text: '1965', startSec: .2, endSec: .4 }, { text: 'xong', startSec: 2, endSec: 2.2 }] } } as unknown as Scene;
    const target = { ...earlier, id: 'scene-2', wordTimings: { audioFileId: 'voice-1', words: [{ text: '1975', startSec: 0, endSec: .2 }, { text: 'xong', startSec: 2, endSec: 2.2 }] } } as unknown as Scene;

    const props = await buildRemotionInputProps(project, [target], 'render-preview-years', resolver, { keywordContextScenes: [earlier, target] });

    expect(props.scenes[0]?.keywords[0]).toMatchObject({ kind: 'year', year: 1975, fromYear: 1965 });
  });

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
      await expect(renderer.renderFullVideo(project, async (message) => { logs.push(message); }, async () => undefined)).rejects.toMatchObject({ code: 'REMOTION_RENDER_FAILED', status: 502 });

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

  it('turns progress log write failures into controlled render failures', async () => {
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'remotion-log-failure-source-'));
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'remotion-log-failure-bundle-'));
    try {
      await writeFile(path.join(sourceDir, 'image.png'), 'image');
      const resolver = async () => ({ absolutePath: path.join(sourceDir, 'image.png'), mimeType: 'image/png', purpose: 'reference' as const });
      const bundle = vi.fn().mockResolvedValue(bundleDir);
      const selectComposition = vi.fn().mockResolvedValue({ id: 'VideoComposition', width: 1920, height: 1080, fps: 30, durationInFrames: 30 });
      const renderMedia = vi.fn(async (options: RenderMediaOptions) => {
        options.onProgress?.({
          renderedFrames: 15,
          encodedFrames: 15,
          encodedDoneIn: 1,
          renderedDoneIn: 1,
          renderEstimatedTime: 1,
          progress: 0.5,
          stitchStage: 'encoding',
        });
        return { buffer: null, slowestFrames: [], contentType: 'video/mp4' };
      });
      const renderer = new RemotionRenderer({ resolver, bundle, selectComposition, renderMedia });
      const scene = { id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxFileId: null, durationSec: 1 } as never;
      const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null, scenes: [scene] } as never;
      const appendLog = vi.fn(async (message: string) => {
        if (message.includes('progress')) throw new Error('log write failed');
      });

      await expect(renderer.renderFullVideo(project, appendLog, async () => undefined)).rejects.toMatchObject({ code: 'REMOTION_RENDER_FAILED', status: 502 });
      expect(appendLog).toHaveBeenCalledWith('Remotion render progress 50%.');
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });

  it('reports staging, render callback, and completion progress', async () => {
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'remotion-progress-source-'));
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'remotion-progress-bundle-'));
    try {
      await writeFile(path.join(sourceDir, 'image.png'), 'image');
      const resolver = async () => ({ absolutePath: path.join(sourceDir, 'image.png'), mimeType: 'image/png', purpose: 'reference' as const });
      const bundle = vi.fn().mockResolvedValue(bundleDir);
      const selectComposition = vi.fn().mockResolvedValue({ id: 'VideoComposition', width: 1920, height: 1080, fps: 30, durationInFrames: 30 });
      const renderMedia = vi.fn(async (options: RenderMediaOptions) => {
        options.onProgress?.({ renderedFrames: 15, encodedFrames: 15, encodedDoneIn: 1, renderedDoneIn: 1, renderEstimatedTime: 1, progress: 0.5, stitchStage: 'encoding' });
        return { buffer: null, slowestFrames: [], contentType: 'video/mp4' };
      });
      const renderer = new RemotionRenderer({ resolver, bundle, selectComposition, renderMedia, readFile: vi.fn().mockResolvedValue(Buffer.from('mp4')) });
      const scene = { id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxFileId: null, durationSec: 1 } as never;
      const project = { id: 'project-1', renderSettings: { fps: 30, width: 1920, height: 1080 }, bgmFileId: null, scenes: [scene] } as never;
      const progress: number[] = [];

      await expect(renderer.renderFullVideo(project, async () => undefined, async (percent) => { progress.push(percent); })).resolves.toEqual(Buffer.from('mp4'));

      expect(progress).toEqual([10, 15, 55, 100]);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });
});

describe('Remotion bundle lifecycle', () => {
  it('places the local Noto Sans Vietnamese font faces and OFL licence in the bundle public directory', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'remotion-bundle-font-'));
    const bundleMock = vi.fn(async (options: BundleOptions) => {
      await expect(readFile(path.join(options.publicDir!, 'fonts', 'NotoSans-vietnamese.woff2'))).resolves.toHaveLength(5700);
      await expect(readFile(path.join(options.publicDir!, 'fonts', 'NotoSans-latin.woff2'))).resolves.toHaveLength(13464);
      await expect(readFile(path.join(options.publicDir!, 'fonts', 'NotoSans-OFL.txt'), 'utf8')).resolves.toContain('SIL OPEN FONT LICENSE');
      return directory;
    });
    try {
      configureRemotionBundle(directory, bundleMock as never);
      await expect(getRemotionBundle()).resolves.toBe(directory);
    } finally {
      configureRemotionBundle('./data/remotion-public');
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('caches a successful bundle and retries after a rejection or configuration change', async () => {
    const dirOne = await mkdtemp(path.join(tmpdir(), 'remotion-bundle-one-'));
    const dirTwo = await mkdtemp(path.join(tmpdir(), 'remotion-bundle-two-'));
    const bundleMock = vi.fn().mockResolvedValue('C:/bundle-one');
    try {
      configureRemotionBundle(dirOne, bundleMock as never);
      await expect(getRemotionBundle()).resolves.toBe('C:\\bundle-one');
      await expect(getRemotionBundle()).resolves.toBe('C:\\bundle-one');
      expect(bundleMock).toHaveBeenCalledOnce();

      configureRemotionBundle(dirTwo, bundleMock as never);
      bundleMock.mockRejectedValueOnce(new Error('bundle failed'));
      await expect(getRemotionBundle()).rejects.toThrow('bundle failed');
      bundleMock.mockResolvedValueOnce('C:/bundle-two');
      await expect(getRemotionBundle()).resolves.toBe('C:\\bundle-two');
      expect(bundleMock).toHaveBeenCalledTimes(3);
    } finally {
      configureRemotionBundle('./data/remotion-public');
      await rm(dirOne, { recursive: true, force: true });
      await rm(dirTwo, { recursive: true, force: true });
    }
  });
});

describe('Remotion acceptance checks', () => {
  it('renders a short image preview when Chromium is available, otherwise skips with a reason', async (context) => {
    let browserStatus: Awaited<ReturnType<typeof ensureBrowser>>;
    try {
      browserStatus = await Promise.race([
        ensureBrowser(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Chromium probe timed out')), 5000)),
      ]);
    } catch (error) {
      context.skip(`Chromium unavailable or unlaunchable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (browserStatus.type === 'no-browser' || browserStatus.type === 'version-mismatch') {
      context.skip(`Chromium unavailable: ${browserStatus.type}`);
      return;
    }

    const sourceDir = await mkdtemp(path.join(tmpdir(), 'remotion-integration-source-'));
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'remotion-integration-bundle-'));
    const releaseRenderLock = await acquireRenderResourceLock();
    try {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      await writeFile(path.join(sourceDir, 'fixture.png'), png);
      const resolver = async () => ({ absolutePath: path.join(sourceDir, 'fixture.png'), mimeType: 'image/png', purpose: 'reference' as const });
      const renderer = new RemotionRenderer({ remotionPublicDir: bundleDir, resolver });
      const scene = { id: 'scene-1', assetType: 'image', assetFileId: 'asset-1', audioFileId: null, sfxFileId: null, durationSec: 1 } as never;
      const project = { id: 'project-1', renderSettings: { fps: 30, width: 320, height: 180 }, bgmFileId: null } as never;

      let output: Buffer;
      try {
        output = await renderer.renderScenePreview(project, scene);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/chrom|browser|puppeteer|executable/i.test(message)) {
          context.skip(`Chromium unavailable or unlaunchable: ${message}`);
          return;
        }
        throw error;
      }
      expect(output.byteLength).toBeGreaterThan(0);
      expect(await readdir(path.join(bundleDir, 'public', 'renders')).catch(() => [])).toHaveLength(0);
    } finally {
      await releaseRenderLock();
      await rm(sourceDir, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('keeps Remotion composition code out of built server, worker, and client artifacts', async (context) => {
    const artifactPaths = ['dist/server.js', 'dist/worker.js'];
    const clientArtifacts = await readdir('dist/client/assets').catch(() => []);
    artifactPaths.push(...clientArtifacts.filter((file) => file.endsWith('.js')).map((file) => path.join('dist/client/assets', file)));
    if (artifactPaths.length === 2) {
      context.skip('Build artifacts are absent; run npm run build before the isolation scan.');
      return;
    }
    const contents = await Promise.all(artifactPaths.map((file) => readFile(file, 'utf8')));
    for (const content of contents) {
      expect(content).not.toMatch(/src[\\/]remotion|VideoComposition|registerRoot|@remotion[\\/]/i);
    }
  });
});
