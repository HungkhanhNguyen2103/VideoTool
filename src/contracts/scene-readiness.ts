import type { Scene } from './project';

export type SceneReadinessKind = 'image' | 'video';
export type SceneReadinessStatus =
  | 'ok'
  | 'missing-asset'
  | 'missing-clip'
  | 'keyframe-only'
  | 'clip-unmeasured'
  | 'clip-cut'
  | 'clip-padded'
  | 'no-tail';

export type SceneReadiness = {
  kind: SceneReadinessKind;
  status: SceneReadinessStatus;
  messages: string[];
  deltaSec?: number;
  needsVoiceover: boolean;
};

const CLIP_EPSILON_SEC = 0.05;

function displaySeconds(seconds: number): string {
  return seconds.toFixed(1);
}

function roundedSeconds(seconds: number): number {
  return Number(seconds.toFixed(1));
}

function addVoiceoverHint(scene: Scene, messages: string[]): boolean {
  const needsVoiceover = scene.audioFileId === null;
  if (needsVoiceover) messages.push('thoi luong scene la uoc tinh, tao voiceover de co thoi luong that');
  return needsVoiceover;
}

function noTailFallback(scene: Scene): string {
  return scene.videoKeyframeFileId !== null ? 'bang khung keyframe' : 'dung khung dau';
}

export function analyzeScene(scene: Scene, _options: { fps?: number } = {}): SceneReadiness {
  void _options;
  const kind: SceneReadinessKind = scene.assetType;
  const messages: string[] = [];
  let status: SceneReadinessStatus = 'ok';
  let deltaSec: number | undefined;

  if (kind === 'image') {
    if (scene.assetFileId === null) {
      status = 'missing-asset';
      messages.push('thieu asset');
    }
  } else if (scene.assetFileId === null) {
    if (scene.videoKeyframeFileId === null) {
      status = 'missing-clip';
      messages.push('video scene chua co clip hoac anh keyframe');
    } else {
      status = 'keyframe-only';
      messages.push('chi co anh keyframe, se hien anh tinh');
    }
  } else if (scene.videoDurationSec === null) {
    status = 'clip-unmeasured';
    messages.push('chua do duoc do dai clip');
  } else {
    const difference = scene.videoDurationSec - scene.durationSec;
    if (difference > CLIP_EPSILON_SEC) {
      status = 'clip-cut';
      deltaSec = roundedSeconds(difference);
      messages.push(`Clip ${displaySeconds(scene.videoDurationSec)}s, scene ${displaySeconds(scene.durationSec)}s: bi cat ${displaySeconds(difference)}s`);
    } else if (difference < -CLIP_EPSILON_SEC) {
      status = 'clip-padded';
      deltaSec = roundedSeconds(Math.abs(difference));
      const fallback = scene.videoTailFileId !== null ? 'bang khung cuoi' : noTailFallback(scene);
      messages.push(`Clip ${displaySeconds(scene.videoDurationSec)}s, scene ${displaySeconds(scene.durationSec)}s: dem ${displaySeconds(Math.abs(difference))}s ${fallback}`);
    } else if (scene.videoTailFileId === null) {
      status = 'no-tail';
      messages.push(`khong co khung cuoi, se ${noTailFallback(scene)}`);
    }
  }

  const needsVoiceover = addVoiceoverHint(scene, messages);
  return { kind, status, messages, ...(deltaSec === undefined ? {} : { deltaSec }), needsVoiceover };
}
