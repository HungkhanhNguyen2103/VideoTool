import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { framesToSeconds, totalSceneFrames } from '../../../contracts/frame-math';
import { createFileStoreService } from '../file-store';
import { buildBgmArguments, buildConcatArguments, buildSceneArguments } from './docs';
import { normalizeSfxForRender } from './sfx-audio';

export interface VideoRenderer {
  renderScenePreview(project: ProjectDetail, scene: Scene): Promise<Buffer>;
  renderFullVideo(project: ProjectDetail, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>, options?: RenderVideoOptions): Promise<Buffer>;
}

export type RenderVideoOptions = { draft?: boolean; originalSceneNumbers?: readonly number[]; originalSceneCount?: number };

type RendererOptions = {
  filesDir?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  resolveFilePath?: ReturnType<typeof createFileStoreService>['resolveFilePath'];
  normalizeSfx?: (sourcePath: string, outputPath: string) => Promise<void>;
};

function runProcess(command: string, args: string[], appendLog?: (message: string) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { if (appendLog) void appendLog(chunk.toString().trim()); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `${command} exited with ${code}.`)));
  });
}

function probeDuration(command: string, inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inputPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      const duration = Number.parseFloat(stdout.trim());
      if (code === 0 && Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error(stderr.trim() || `Could not measure video duration for ${inputPath}.`));
    });
  });
}

function quoteConcatPath(filePath: string): string {
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

export class FfmpegRenderer implements VideoRenderer {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly resolveFilePath: ReturnType<typeof createFileStoreService>['resolveFilePath'];
  private readonly normalizeSfx: (sourcePath: string, outputPath: string) => Promise<void>;

  constructor(options: RendererOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe';
    this.resolveFilePath = options.resolveFilePath ?? createFileStoreService(options.filesDir ?? './data/files').resolveFilePath;
    this.normalizeSfx = options.normalizeSfx ?? ((sourcePath, outputPath) => normalizeSfxForRender({
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath,
      inputPath: sourcePath,
      outputPath,
    }));
  }

  async renderScenePreview(project: ProjectDetail, scene: Scene): Promise<Buffer> {
    const directory = await mkdtemp(path.join(tmpdir(), 'video-tool-preview-'));
    try {
      await this.renderSegment(project, scene, directory, 'preview.mp4');
      return await readFile(path.join(directory, 'preview.mp4'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async renderFullVideo(project: ProjectDetail, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>, options?: RenderVideoOptions): Promise<Buffer> {
    const directory = await mkdtemp(path.join(tmpdir(), 'video-tool-render-'));
    try {
      const segmentPaths: string[] = [];
      for (const [index, scene] of project.scenes.entries()) {
        const sceneNumber = options?.originalSceneNumbers?.[index] ?? index + 1;
        const sceneCount = options?.originalSceneCount ?? project.scenes.length;
        await appendLog(`Rendering scene ${sceneNumber}/${sceneCount}…`);
        const filename = `segment-${String(index + 1).padStart(4, '0')}.mp4`;
        await this.renderSegment(project, scene, directory, filename, appendLog);
        segmentPaths.push(path.join(directory, filename));
        await reportProgress(Math.round(((index + 1) / project.scenes.length) * 90));
      }
      const listPath = path.join(directory, 'segments.txt');
      const concatPath = path.join(directory, 'concat.mp4');
      await writeFile(listPath, segmentPaths.map(quoteConcatPath).join('\n'));
      await runProcess(this.ffmpegPath, buildConcatArguments(listPath, concatPath), appendLog);
      if (!project.bgmFileId) {
        const output = await readFile(concatPath);
        await reportProgress(100);
        return output;
      }
      const bgm = await this.resolveFilePath(project.id, project.bgmFileId);
      const outputPath = path.join(directory, 'final.mp4');
      const totalDuration = framesToSeconds(totalSceneFrames(project.scenes.map((scene) => scene.durationSec), project.renderSettings.fps), project.renderSettings.fps);
      await runProcess(this.ffmpegPath, buildBgmArguments(concatPath, bgm.absolutePath, outputPath, totalDuration), appendLog);
      const output = await readFile(outputPath);
      await reportProgress(100);
      return output;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async renderSegment(project: ProjectDetail, scene: Scene, directory: string, filename: string, appendLog?: (message: string) => Promise<void>): Promise<void> {
    if (!scene.assetFileId) throw new Error(`Scene ${scene.id} has no visual asset.`);
    const asset = await this.resolveFilePath(project.id, scene.assetFileId);
    const audio = scene.audioFileId ? await this.resolveFilePath(project.id, scene.audioFileId) : undefined;
    const sfx = scene.sfxFileId ? await this.resolveFilePath(project.id, scene.sfxFileId) : undefined;
    const normalizedSfxPath = sfx ? path.join(directory, `${path.parse(filename).name}-sfx-normalized.wav`) : undefined;
    if (sfx && normalizedSfxPath) await this.normalizeSfx(sfx.absolutePath, normalizedSfxPath);
    const videoDurationSec = scene.assetType === 'video'
      ? scene.videoDurationSec ?? await probeDuration(this.ffprobePath, asset.absolutePath)
      : null;
    const outputPath = path.join(directory, filename);
    await runProcess(this.ffmpegPath, buildSceneArguments({
      assetType: scene.assetType,
      videoPath: asset.absolutePath,
      audioPath: audio?.absolutePath,
      sfxPath: normalizedSfxPath,
      sfxVolume: project.sfxVolume,
      outputPath,
      durationSec: scene.durationSec,
      videoDurationSec,
      width: project.renderSettings.width,
      height: project.renderSettings.height,
      fps: project.renderSettings.fps,
    }), appendLog);
  }
}
