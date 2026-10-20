import type { AssetType } from '../../../contracts/asset';
import { isSceneActive } from '../../../contracts/scene-active';

type SceneAssetUploadUiInput = {
  assetType: AssetType;
  active?: boolean;
  assetFileId: string | null;
  videoKeyframeFileId: string | null;
};

export function sceneAssetUploadUi(scene: SceneAssetUploadUiInput, studioLocked: boolean, uploading: boolean) {
  const active = isSceneActive(scene);
  return {
    disabled: !active || studioLocked || uploading,
    title: !active ? 'Scene đang tắt — bật lại để dùng chức năng này' : studioLocked ? 'Studio đang xử lý tác vụ khác.' : uploading ? 'Đang tải asset.' : undefined,
    assetAccept: scene.assetType === 'image' ? 'image/*' : 'image/*,video/*',
    assetLabel: scene.assetFileId ? (scene.assetType === 'image' ? 'Thay ảnh' : 'Thay clip') : (scene.assetType === 'image' ? 'Upload ảnh' : 'Upload clip'),
    keyframeVisible: scene.assetType === 'video',
    keyframeLabel: scene.videoKeyframeFileId ? 'Thay keyframe' : 'Upload keyframe',
  };
}
