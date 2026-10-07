import path from 'node:path';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { RemotionInputPropsSchema, type RemotionInputProps, type RemotionSceneProps } from '../../../contracts/video';
import type { FilePurpose } from '../../../contracts/file';
import { AppError } from '../../shared/errors';
import { annotateNameKeywords, annotateYearKeywords, resolveFilmLookByScene, selectProjectSceneKeywords } from './keywords';
import { isDepthSceneEligible } from './depth-eligibility';

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

export type RemotionKeywordContext = {
  /** Full project scene order used for year chaining; preview renders may stage fewer scenes. */
  keywordContextScenes?: ReadonlyArray<Scene>;
};

export type RemotionProjectSettings = Pick<ProjectDetail, 'id' | 'renderSettings' | 'bgmFileId' | 'keywordPopupsEnabled'>
  & Partial<Pick<ProjectDetail, 'transitionStyle' | 'filmLook' | 'parallax' | 'logoFileId' | 'sfxVolume'>>;

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
  project: RemotionProjectSettings,
  scenes: ReadonlyArray<Scene>,
  renderId: string,
  resolver: RenderFileResolver,
  options: RemotionKeywordContext = {},
): Promise<ResolvedRemotionAssets> {
  validateRenderId(renderId);
  const sources: RemotionSource[] = [];
  const sceneProps: RemotionSceneProps[] = [];
  const keywordContextScenes = options.keywordContextScenes ?? scenes;
  const contextKeywords = selectProjectSceneKeywords(keywordContextScenes).map((selection) => selection.keywords);
  const annotatedContextKeywords = annotateNameKeywords(annotateYearKeywords(contextKeywords));
  const keywordsBySceneId = new Map(keywordContextScenes.map((scene, index) => [scene.id, annotatedContextKeywords[index]!]));
  const filmLookByScene = resolveFilmLookByScene(annotatedContextKeywords, project.filmLook ?? 'auto');
  const filmLookBySceneId = new Map(keywordContextScenes.map((scene, index) => [scene.id, filmLookByScene[index] ?? false]));

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

    let videoKeyframeRelPath: string | null = null;
    if (scene.assetType === 'video' && scene.videoKeyframeFileId) {
      const keyframe = await resolveFile(
        project.id,
        scene.videoKeyframeFileId,
        resolver,
        'reference',
        'image/',
        `Scene ${scene.id} video keyframe`,
      );
      videoKeyframeRelPath = `${prefix}-keyframe.${keyframe.extension}`;
      sources.push({ absolutePath: keyframe.file.absolutePath, relativePath: videoKeyframeRelPath });
    }

    let depthMapRelPath: string | null = null;
    if (isDepthSceneEligible(project.parallax ?? 'off', scene) && scene.depthMap) {
      const depth = await resolveFile(project.id, scene.depthMap.fileId, resolver, 'depth', 'image/', `Scene ${scene.id} depth map`);
      if (depth.file.mimeType !== 'image/png' || depth.extension !== 'png') throw invalidAsset(`Scene ${scene.id} depth map must be a PNG.`);
      depthMapRelPath = `${prefix}-depth.png`;
      sources.push({ absolutePath: depth.file.absolutePath, relativePath: depthMapRelPath });
    }

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
      videoKeyframeRelPath,
      videoTailRelPath: null,
      videoDurationSec: scene.assetType === 'video' ? scene.videoDurationSec : null,
      depthMapRelPath,
      durationSec: scene.durationSec,
      filmLook: filmLookBySceneId.get(scene.id) ?? false,
      keywords: project.keywordPopupsEnabled === false ? [] : keywordsBySceneId.get(scene.id) ?? [],
    });
  }

  let bgmRelPath: string | null = null;
  if (project.bgmFileId) {
    const bgm = await resolveFile(project.id, project.bgmFileId, resolver, 'bgm', 'audio/', 'Project BGM');
    bgmRelPath = `renders/${renderId}/bgm.${bgm.extension}`;
    sources.push({ absolutePath: bgm.file.absolutePath, relativePath: bgmRelPath });
  }

  let logoRelPath: string | null = null;
  if (project.logoFileId) {
    try {
      const logo = await resolveFile(project.id, project.logoFileId, resolver, 'logo', 'image/', 'Project logo');
      logoRelPath = `renders/${renderId}/logo.${logo.extension}`;
      sources.push({ absolutePath: logo.file.absolutePath, relativePath: logoRelPath });
    } catch {
      throw invalidAsset('Project logo is missing or invalid.');
    }
  }

  const inputProps = RemotionInputPropsSchema.parse({
    fps: project.renderSettings.fps,
    width: project.renderSettings.width,
    height: project.renderSettings.height,
    sfxVolume: project.sfxVolume ?? 0.5,
    scenes: sceneProps,
    bgmRelPath,
    logoRelPath,
    transitionStyle: project.transitionStyle ?? 'varied',
    parallax: project.parallax ?? 'off',
  });
  return { inputProps, sources };
}

export async function buildRemotionInputProps(
  project: RemotionProjectSettings,
  scenes: ReadonlyArray<Scene>,
  renderId: string,
  resolver: RenderFileResolver,
  options: RemotionKeywordContext = {},
): Promise<RemotionInputProps> {
  return (await resolveRemotionAssets(project, scenes, renderId, resolver, options)).inputProps;
}
