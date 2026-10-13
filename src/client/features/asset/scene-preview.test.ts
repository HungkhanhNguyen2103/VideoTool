import type { ComponentProps } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { createScenePreviewFingerprint, firstChangedScenePreviewField, scenePreviewStaleReason, scenePreviewStatusText } from './scene-preview';
import { ScenePreviewSection } from './ScenePreviewSection';

vi.mock('./StudioPage.module.css', () => ({ default: new Proxy({}, { get: (_target, property) => String(property) }) }));

const scene = {
  id: 'scene-1', narration: 'Narration', visualPrompt: 'Visual', durationSec: 8, assetType: 'video', assetFileId: 'asset-1',
  audioFileId: 'voice-1', sfxPrompt: 'rain', motionPrompt: 'push in', sfxFileId: 'sfx-1', videoKeyframeFileId: 'key-1', videoTailFileId: 'tail-1',
  depthMap: { assetFileId: 'asset-1', fileId: 'depth-1', score: 0.9 },
} as Scene;
const project = {
  renderEngine: 'remotion', keywordPopupsEnabled: true, transitionStyle: 'varied', filmLook: 'auto', parallax: 'auto', logoFileId: 'logo-1',
  renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
} as ProjectDetail;

function componentMarkup(overrides: Partial<ComponentProps<typeof ScenePreviewSection>> = {}): string {
  return renderToStaticMarkup(createElement(ScenePreviewSection, {
    scene,
    sceneNumber: 8,
    project,
    preview: null,
    error: null,
    studioLocked: false,
    onRender: () => undefined,
    ...overrides,
  }));
}

describe('scene preview helpers', () => {
  it('creates equal fingerprints for unchanged scene and render inputs', () => {
    const fingerprint = createScenePreviewFingerprint(scene, project);

    expect(firstChangedScenePreviewField(fingerprint, { ...fingerprint, asset: { ...fingerprint.asset } })).toBeNull();
  });

  it('returns the first changed field in the requested scene-content order', () => {
    const fingerprint = createScenePreviewFingerprint(scene, project);
    const changed = { ...fingerprint, narration: 'Updated', visualPrompt: 'Updated visual' };

    expect(firstChangedScenePreviewField(fingerprint, changed)).toBe('narration');
    expect(scenePreviewStaleReason(fingerprint, changed)).toBe('lời dẫn scene đã thay đổi sau lần render');
  });

  it('detects render settings changes without treating a copied object as new', () => {
    const fingerprint = createScenePreviewFingerprint(scene, project);
    const changed: typeof fingerprint = { ...fingerprint, renderSettings: { ...fingerprint.renderSettings, fps: 60 } };

    expect(firstChangedScenePreviewField(fingerprint, changed)).toBe('renderSettings');
    expect(scenePreviewStaleReason(fingerprint, changed)).toBe('cấu hình video đã thay đổi sau lần render');
  });

  it('marks a preview stale when the stored popup plan changes', () => {
    const fingerprint = createScenePreviewFingerprint({ ...scene, popupPlan: null } as Scene, project);
    const changed = createScenePreviewFingerprint({ ...scene, popupPlan: { needed: true } } as Scene, project);

    expect(firstChangedScenePreviewField(fingerprint, changed)).toBe('popupPlan');
    expect(scenePreviewStaleReason(fingerprint, changed)).toContain('popup');
  });

  it('does not stale a preview when only the retained tail reference changes', () => {
    const fingerprint = createScenePreviewFingerprint(scene, project);
    const changed = { ...scene, videoTailFileId: 'new-tail' };

    expect(firstChangedScenePreviewField(fingerprint, createScenePreviewFingerprint(changed, project))).toBeNull();
  });

  it('formats the render arrival time, scene duration, and engine', () => {
    const renderedAt = new Date(2026, 9, 7, 11, 8).getTime();

    expect(scenePreviewStatusText(renderedAt, 8, 'remotion')).toBe('Render lúc 11:08 · scene 8s · engine Remotion');
    expect(scenePreviewStatusText(renderedAt, 8.5, 'ffmpeg')).toBe('Render lúc 11:08 · scene 8.5s · engine FFmpeg');
  });

  it('renders the result player, status line, and rerender action inside the section', () => {
    const html = componentMarkup({ preview: { url: 'blob:preview-8', renderedAt: new Date(2026, 9, 7, 11, 8).getTime(), fingerprint: createScenePreviewFingerprint(scene, project) } });

    expect(html).toContain('Preview render');
    expect(html).toContain('Preview render scene 8');
    expect(html).toContain('Render lúc 11:08 · scene 8s · engine Remotion');
    expect(html).toContain('Render lại preview');
    expect(html).toContain('Preview chỉ lưu trong phiên này; tải lại trang sẽ mất.');
  });

  it('shows only the active FFmpeg preview description', () => {
    const html = componentMarkup({ project: { ...project, renderEngine: 'ffmpeg' } });

    expect(html).toContain('Chỉ có asset + voiceover/SFX; bỏ hiệu ứng Remotion và logo.');
    expect(html).not.toContain('Có voiceover/SFX, hiệu ứng Remotion và logo nếu có; không có BGM dự án.');
  });

  it('shows a stale reason from the first changed fingerprint field without the old extra link', () => {
    const fingerprint = createScenePreviewFingerprint(scene, project);
    const changedScene = { ...scene, narration: 'Updated narration' };
    const html = componentMarkup({
      preview: { url: 'blob:preview-8', renderedAt: 0, fingerprint },
      currentScene: changedScene,
    });

    expect(html).toContain('Preview có thể đã cũ');
    expect(html).toContain('lời dẫn scene đã thay đổi sau lần render');
    expect(html).not.toContain('Cập nhật lời dẫn để làm mới');
  });

  it('keeps a failed render error inside the section and leaves retry enabled', () => {
    const html = componentMarkup({ error: 'Remotion render failed: missing asset.' });

    expect(html).toContain('Remotion render failed: missing asset.');
    expect(html).toContain('Render preview');
    expect(html).not.toContain('disabled');
  });
});
