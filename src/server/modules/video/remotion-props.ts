import path from 'node:path';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { RemotionInputPropsSchema, type RemotionInputProps, type RemotionSceneProps } from '../../../contracts/video';
import type { FilePurpose } from '../../../contracts/file';
import { AppError } from '../../shared/errors';
import { selectKeywords } from './keywords';

export type ResolvedRenderFile = {
  absolutePath: string;
  mimeType: string;
  purpose: FilePurpose;
};

export type RenderFileResolver = (projectId: string, fileId: string) => Promise<ResolvedRenderFile>;

export type RemotionSource = {
  absolutePath: string;
  relativePath: string;
};

export type ResolvedRemotionAssets = {
  inputProps: RemotionInputProps;
  sources: RemotionSource[];
};

const EXTENSION_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4'],
  'video/quicktime': ['mov'],
  'audio/wav': ['wav'],
  'audio/mpeg': ['mp3'],
};

function invalidAsset(message: string): AppError {
  return new AppError(message, 422, 'INVALID_RENDER_ASSET');
}

function validateRenderId(renderId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(renderId)) throw invalidAsset('Render id contains unsafe characters.');
}

function resolveExtension(file: ResolvedRenderFile, label: string): string {
  const extension = path.extname(file.absolutePath).slice(1).toLowerCase();
  const allowed = EXTENSION_BY_MIME[file.mimeType];
  if (!allowed || !allowed.includes(extension)) {
    throw invalidAsset(`${label} has an unsupported MIME type or extension.`);
  }
  return extension;
}

async function resolveFile(
  projectId: string,
  fileId: string,
  resolver: RenderFileResolver,
  expectedPurpose: FilePurpose,
  expectedMimePrefix: string,
  label: string,
): Promise<{ file: ResolvedRenderFile; extension: string }> {
  const file = await resolver(projectId, fileId);
  if (file.purpose !== expectedPurpose || !file.mimeType.startsWith(expectedMimePrefix)) {
    throw invalidAsset(`${label} has an unexpected purpose or MIME type.`);
  }
  return { file, extension: resolveExtension(file, label) };
}

export async function resolveRemotionAssets(
  project: Pick<ProjectDetail, 'id' | 'renderSettings' | 'bgmFileId' | 'keywordPopupsEnabled'>,
  scenes: ReadonlyArray<Scene>,
  renderId: string,
  resolver: RenderFileResolver,
): Promise<ResolvedRemotionAssets> {
  validateRenderId(renderId);
  const sources: RemotionSource[] = [];
  const sceneProps: RemotionSceneProps[] = [];

  for (const [index, scene] of scenes.entries()) {
    if (!scene.assetFileId) throw invalidAsset(`Scene ${scene.id} has no visual asset.`);
    const visual = await resolveFile(
      project.id,
      scene.assetFileId,
      resolver,
      'reference',
      scene.assetType === 'image' ? 'image/' : 'video/',
      `Scene ${scene.id} visual asset`,
    );
    const prefix = `renders/${renderId}/scene-${String(index + 1).padStart(2, '0')}`;
    const assetRelPath = `${prefix}-asset.${visual.extension}`;
    sources.push({ absolutePath: visual.file.absolutePath, relativePath: assetRelPath });

    let voiceRelPath: string | null = null;
    if (scene.audioFileId) {
      const voice = await resolveFile(project.id, scene.audioFileId, resolver, 'voiceover', 'audio/', `Scene ${scene.id} voiceover`);
      voiceRelPath = `${prefix}-voice.${voice.extension}`;
      sources.push({ absolutePath: voice.file.absolutePath, relativePath: voiceRelPath });
    }

    let sfxRelPath: string | null = null;
    if (scene.sfxFileId) {
      const sfx = await resolveFile(project.id, scene.sfxFileId, resolver, 'sfx', 'audio/', `Scene ${scene.id} SFX`);
      sfxRelPath = `${prefix}-sfx.${sfx.extension}`;
      sources.push({ absolutePath: sfx.file.absolutePath, relativePath: sfxRelPath });
    }

    sceneProps.push({
      id: scene.id,
      assetType: scene.assetType,
      assetRelPath,
      voiceRelPath,
      sfxRelPath,
      durationSec: scene.durationSec,
      keywords: project.keywordPopupsEnabled && scene.audioFileId && scene.wordTimings?.audioFileId === scene.audioFileId
        ? selectKeywords(scene.wordTimings.words)
        : [],
    });
  }

  let bgmRelPath: string | null = null;
  if (project.bgmFileId) {
    const bgm = await resolveFile(project.id, project.bgmFileId, resolver, 'bgm', 'audio/', 'Project BGM');
    bgmRelPath = `renders/${renderId}/bgm.${bgm.extension}`;
    sources.push({ absolutePath: bgm.file.absolutePath, relativePath: bgmRelPath });
  }

  const inputProps = RemotionInputPropsSchema.parse({
    fps: project.renderSettings.fps,
    width: project.renderSettings.width,
    height: project.renderSettings.height,
    scenes: sceneProps,
    bgmRelPath,
  });
  return { inputProps, sources };
}

export async function buildRemotionInputProps(
  project: Pick<ProjectDetail, 'id' | 'renderSettings' | 'bgmFileId' | 'keywordPopupsEnabled'>,
  scenes: ReadonlyArray<Scene>,
  renderId: string,
  resolver: RenderFileResolver,
): Promise<RemotionInputProps> {
  return (await resolveRemotionAssets(project, scenes, renderId, resolver)).inputProps;
}
