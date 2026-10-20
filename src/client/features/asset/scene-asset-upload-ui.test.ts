import { describe, expect, it } from 'vitest';
import { sceneAssetUploadUi } from './scene-asset-upload-ui';

describe('scene asset upload UI state', () => {
  it('labels image and video controls from scene state', () => {
    expect(sceneAssetUploadUi({ assetType: 'image', active: true, assetFileId: null, videoKeyframeFileId: null }, false, false)).toMatchObject({ assetLabel: 'Upload ảnh', assetAccept: 'image/*', keyframeVisible: false, disabled: false });
    expect(sceneAssetUploadUi({ assetType: 'video', active: true, assetFileId: 'clip', videoKeyframeFileId: 'key' }, false, false)).toMatchObject({ assetLabel: 'Thay clip', assetAccept: 'image/*,video/*', keyframeLabel: 'Thay keyframe', keyframeVisible: true });
  });

  it('uses the shared inactive tooltip and disables locked or uploading controls', () => {
    expect(sceneAssetUploadUi({ assetType: 'video', active: false, assetFileId: null, videoKeyframeFileId: null }, false, false)).toMatchObject({ disabled: true, title: 'Scene đang tắt — bật lại để dùng chức năng này' });
    expect(sceneAssetUploadUi({ assetType: 'image', active: true, assetFileId: null, videoKeyframeFileId: null }, true, false).disabled).toBe(true);
    expect(sceneAssetUploadUi({ assetType: 'image', active: true, assetFileId: null, videoKeyframeFileId: null }, false, true).disabled).toBe(true);
  });
});
