import type { ProjectDetail, RenderEngine, Scene } from '../../../contracts/project';
import { formatDurationSeconds } from '../../../contracts/scene-duration';
import { hashNarration } from '../../../contracts/name-keywords';

export type ScenePreviewFingerprint = {
  narration: string;
  visualPrompt: string;
  asset: {
    type: Scene['assetType'];
    fileId: string | null;
    keyframeFileId: string | null;
    depthMapFileId: string | null;
  };
  voiceover: string | null;
  sfx: string | null;
  motionPrompt: string;
  durationSec: number;
  renderSettings: ProjectDetail['renderSettings'];
  renderEngine: RenderEngine;
  keywordPopups: boolean;
  popupPlan: string | null;
  transitionStyle: ProjectDetail['transitionStyle'];
  filmLook: ProjectDetail['filmLook'];
  parallax: ProjectDetail['parallax'];
  logo: string | null;
};

export type ScenePreviewChangedField =
  | 'narration'
  | 'visualPrompt'
  | 'asset'
  | 'voiceover'
  | 'sfx'
  | 'motionPrompt'
  | 'durationSec'
  | 'renderSettings'
  | 'renderEngine'
  | 'keywordPopups'
  | 'popupPlan'
  | 'transitionStyle'
  | 'filmLook'
  | 'parallax'
  | 'logo';

const CHANGE_REASONS: Record<ScenePreviewChangedField, string> = {
  popupPlan: 'popup plan changed after render',
  narration: 'lời dẫn scene đã thay đổi sau lần render',
  visualPrompt: 'visual prompt scene đã thay đổi sau lần render',
  asset: 'asset scene đã thay đổi sau lần render',
  voiceover: 'voiceover scene đã thay đổi sau lần render',
  sfx: 'SFX scene đã thay đổi sau lần render',
  motionPrompt: 'motion prompt scene đã thay đổi sau lần render',
  durationSec: 'thời lượng scene đã thay đổi sau lần render',
  renderSettings: 'cấu hình video đã thay đổi sau lần render',
  renderEngine: 'engine render đã thay đổi sau lần render',
  keywordPopups: 'chữ pop-up đã thay đổi sau lần render',
  transitionStyle: 'chuyển cảnh đã thay đổi sau lần render',
  filmLook: 'hiệu ứng phim cũ đã thay đổi sau lần render',
  parallax: 'hiệu ứng chiều sâu đã thay đổi sau lần render',
  logo: 'logo video đã thay đổi sau lần render',
};

export function createScenePreviewFingerprint(scene: Scene, project: ProjectDetail): ScenePreviewFingerprint {
  return {
    narration: scene.narration,
    visualPrompt: scene.visualPrompt,
    asset: {
      type: scene.assetType,
      fileId: scene.assetFileId,
      keyframeFileId: scene.videoKeyframeFileId,
      depthMapFileId: scene.depthMap?.fileId ?? null,
    },
    voiceover: scene.audioFileId,
    sfx: scene.sfxFileId,
    motionPrompt: scene.motionPrompt,
    durationSec: scene.durationSec,
    renderSettings: { ...project.renderSettings },
    renderEngine: project.renderEngine,
    keywordPopups: project.keywordPopupsEnabled,
    popupPlan: scene.popupPlan ? hashNarration(JSON.stringify(scene.popupPlan)) : null,
    transitionStyle: project.transitionStyle,
    filmLook: project.filmLook,
    parallax: project.parallax,
    logo: project.logoFileId,
  };
}

const CHANGED_FIELDS: ReadonlyArray<ScenePreviewChangedField> = [
  'narration', 'visualPrompt', 'asset', 'voiceover', 'sfx', 'motionPrompt', 'durationSec',
  'renderSettings', 'renderEngine', 'keywordPopups', 'popupPlan', 'transitionStyle', 'filmLook', 'parallax', 'logo',
];

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function firstChangedScenePreviewField(previous: ScenePreviewFingerprint, current: ScenePreviewFingerprint): ScenePreviewChangedField | null {
  for (const field of CHANGED_FIELDS) {
    if (!sameValue(previous[field], current[field])) return field;
  }
  return null;
}

export function scenePreviewStaleReason(previous: ScenePreviewFingerprint, current: ScenePreviewFingerprint): string | null {
  const field = firstChangedScenePreviewField(previous, current);
  return field ? CHANGE_REASONS[field] : null;
}

export function scenePreviewStatusText(renderedAt: number, durationSec: number, renderEngine: RenderEngine): string {
  const time = new Date(renderedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const duration = formatDurationSeconds(durationSec);
  return `Render lúc ${time} · scene ${duration}s · engine ${renderEngine === 'remotion' ? 'Remotion' : 'FFmpeg'}`;
}
