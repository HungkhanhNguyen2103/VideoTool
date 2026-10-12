import type { ProjectDetail, Scene } from '../../../contracts/project';
import { isVoiceoverFresh } from '../../../contracts/voiceover';

export type VoiceoverListenState = {
  currentIndex: number;
  isPlaying: boolean;
  blocked: 'missing' | 'stale' | null;
  reloadVersion: number;
};

export type VoiceoverListenAction =
  | { type: 'toggle-play' }
  | { type: 'next'; sceneCount: number }
  | { type: 'previous'; sceneCount: number }
  | { type: 'select'; index: number }
  | { type: 'blocked'; reason: 'missing' | 'stale' }
  | { type: 'regenerated' }
  | { type: 'ended' };

export function voiceoverListenReducer(state: VoiceoverListenState, action: VoiceoverListenAction): VoiceoverListenState {
  switch (action.type) {
    case 'toggle-play':
      return { ...state, isPlaying: !state.isPlaying, blocked: null };
    case 'next':
      return { ...state, currentIndex: Math.min(Math.max(action.sceneCount - 1, 0), state.currentIndex + 1), isPlaying: action.sceneCount > 0, blocked: null };
    case 'previous':
      return { ...state, currentIndex: Math.max(0, state.currentIndex - 1), isPlaying: action.sceneCount > 0, blocked: null };
    case 'select':
      return { ...state, currentIndex: Math.max(0, action.index), isPlaying: true, blocked: null };
    case 'blocked':
      return { ...state, isPlaying: false, blocked: action.reason };
    case 'regenerated':
      return { ...state, blocked: null, reloadVersion: state.reloadVersion + 1 };
    case 'ended':
      return { ...state, isPlaying: false };
  }
}

export function voiceoverSceneStatus(
  scene: Pick<Scene, 'narration' | 'audioFileId' | 'voiceoverInput'>,
  project: Pick<ProjectDetail, 'voiceoverVoice' | 'voiceSpeed'>,
): 'ready' | 'missing' | 'stale' {
  if (scene.audioFileId === null) return 'missing';
  return isVoiceoverFresh(scene, project) ? 'ready' : 'stale';
}

export function audioUrlWithCacheBust(url: string, version: number): string {
  if (version === 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}voiceoverVersion=${version}`;
}

export type VoiceoverAudioPort = {
  currentTime: number;
  pause: () => void;
  load: () => void;
  play: () => Promise<void>;
};

export function resetVoiceoverAudio(audio: VoiceoverAudioPort, source?: string): void {
  audio.pause();
  audio.currentTime = 0;
  if (source) audio.load();
}

export async function syncVoiceoverAudio(
  audio: VoiceoverAudioPort,
  input: {
    isPlaying: boolean;
    status: 'ready' | 'missing' | 'stale';
    hasSource: boolean;
    onBlocked: (status: 'missing' | 'stale') => void;
    onAutoplayRejected: () => void;
  },
): Promise<'idle' | 'blocked' | 'playing' | 'autoplay-error'> {
  if (!input.isPlaying) {
    audio.pause();
    return 'idle';
  }
  if (input.status !== 'ready' || !input.hasSource) {
    audio.pause();
    input.onBlocked(input.status === 'stale' ? 'stale' : 'missing');
    return 'blocked';
  }
  try {
    await audio.play();
    return 'playing';
  } catch {
    input.onAutoplayRejected();
    return 'autoplay-error';
  }
}

export function shouldToggleVoiceoverOnSpace(event: KeyboardEvent): boolean {
  if (event.key !== ' ') return false;
  const target = event.target as HTMLElement | null;
  if (!target) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return false;
  return !target.isContentEditable;
}
