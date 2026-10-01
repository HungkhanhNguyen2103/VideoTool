import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { createFileStoreService } from '../file-store';
import { buildBgmArguments, buildConcatArguments, buildSceneArguments } from './docs';

export interface VideoRenderer {
  renderScenePreview(project: ProjectDetail, scene: Scene): Promise<Buffer>;
  renderFullVideo(project: ProjectDetail, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>, options?: RenderVideoOptions): Promise<Buffer>;
}

export type RenderVideoOptions = { draft?: boolean };

type RendererOptions = { filesDir?: string; ffmpegPath?: string; resolveFilePath?: ReturnType<typeof createFileStoreService>['resolveFilePath'] };

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

function quoteConcatPath(filePath: string): string {
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

export class FfmpegRenderer implements VideoRenderer {
  private readonly ffmpegPath: string;
  private readonly resolveFilePath: ReturnType<typeof createFileStoreService>['resolveFilePath'];

  constructor(options: RendererOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
    this.resolveFilePath = options.resolveFilePath ?? createFileStoreService(options.filesDir ?? './data/files').resolveFilePath;
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

  async renderFullVideo(project: ProjectDetail, appendLog: (message: string) => Promise<void>, reportProgress: (percent: number) => Promise<void>, _options?: RenderVideoOptions): Promise<Buffer> {
    void _options;
    const directory = await mkdtemp(path.join(tmpdir(), 'video-tool-render-'));
    try {
      const segmentPaths: string[] = [];
      for (const [index, scene] of project.scenes.entries()) {
        await appendLog(`Rendering scene ${index + 1}/${project.scenes.length}…`);
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
      const totalDuration = project.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
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
    const outputPath = path.join(directory, filename);
    await runProcess(this.ffmpegPath, buildSceneArguments({
      assetType: scene.assetType,
      videoPath: asset.absolutePath,
      audioPath: audio?.absolutePath,
      sfxPath: sfx?.absolutePath,
      outputPath,
      durationSec: scene.durationSec,
      width: project.renderSettings.width,
      height: project.renderSettings.height,
      fps: project.renderSettings.fps,
    }), appendLog);
  }
}
