import { ASSET_TYPES, type AssetType, type FlowSceneExport } from '../../../contracts/asset';
import type { ProjectDetail } from '../../../contracts/project';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm'] as const;
export { ASSET_TYPES };
export type { AssetType, FlowSceneExport };

export const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export function expectedAssetType(extension: string): AssetType | null {
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return 'image';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(extension)) return 'video';
  return null;
}

export type AssetProject = Pick<ProjectDetail, 'id' | 'scenes'>;
