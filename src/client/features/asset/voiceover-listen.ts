import type { ProjectDetail, Scene } from '../../../contracts/project';
import { SceneTailSecSchema, hasUnappliedSceneTailForScene, roundDurationSeconds } from '../../../contracts/scene-duration';
import { isVoiceoverFresh } from '../../../contracts/voiceover';
import { activeScenes } from '../../../contracts/scene-active';

export type VoiceoverListenQueueEntry = { scene: Scene; sceneNumber: number };

export function buildVoiceoverListenQueue(scenes: readonly Scene[]): VoiceoverListenQueueEntry[] {
  return activeScenes(scenes.map((scene, index) => ({ scene, sceneNumber: index + 1, active: scene.active })))
    .map(({ scene, sceneNumber }) => ({ scene, sceneNumber }));
}

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

export type VoiceoverEndDecision =
  | { kind: 'advance'; nextIndex: number }
  | { kind: 'wait'; nextIndex: number; waitMs: number }
  | { kind: 'blocked'; reason: 'missing' | 'stale' }
  | { kind: 'stop' }
  | { kind: 'finished' };

export function decideVoiceoverEnd(input: {
  currentIndex: number;
  sceneCount: number;
  autoAdvance: boolean;
  waitSeconds: number;
  nextStatus: 'ready' | 'missing' | 'stale' | null;
}): VoiceoverEndDecision {
  const nextIndex = input.currentIndex + 1;
  if (nextIndex >= input.sceneCount) return { kind: 'finished' };
  if (!input.autoAdvance) return { kind: 'stop' };
  if (input.nextStatus === 'missing' || input.nextStatus === 'stale') return { kind: 'blocked', reason: input.nextStatus };
  const waitMs = Math.max(0, Math.round(input.waitSeconds * 1000));
  return waitMs > 0 ? { kind: 'wait', nextIndex, waitMs } : { kind: 'advance', nextIndex };
}

export function resolveVoiceoverTailSeconds(input: string, savedValue: number): number {
  if (input.trim() === '') return savedValue;
  const parsed = SceneTailSecSchema.safeParse(Number(input));
  return parsed.success ? parsed.data : savedValue;
}

/** Task 84 stores raw mastered-WAV duration; sceneTailSec is render-time apad, so known in-file tail is zero. */
export const KNOWN_IN_FILE_VOICEOVER_TAIL_SECONDS = 0;

export function voiceoverTailWaitSeconds(inputTailSeconds: number): number {
  return Math.max(0, roundDurationSeconds(inputTailSeconds - KNOWN_IN_FILE_VOICEOVER_TAIL_SECONDS));
}

export function voiceoverSceneHasUnappliedTail(scene: Pick<Scene, 'audioFileId' | 'durationSec' | 'voiceoverDurationSec'>, inputTailSeconds: number): boolean {
  return hasUnappliedSceneTailForScene(scene, inputTailSeconds);
}

type VoiceoverPreferenceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const VOICEOVER_AUTO_ADVANCE_KEY = 'video-tool:voiceover-auto-advance';

function defaultVoiceoverPreferenceStorage(): VoiceoverPreferenceStorage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readVoiceoverAutoAdvancePreference(storage = defaultVoiceoverPreferenceStorage()): boolean {
  try {
    return storage?.getItem(VOICEOVER_AUTO_ADVANCE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeVoiceoverAutoAdvancePreference(enabled: boolean, storage = defaultVoiceoverPreferenceStorage()): void {
  try {
    storage?.setItem(VOICEOVER_AUTO_ADVANCE_KEY, String(enabled));
  } catch {
    // Private browsing and hardened browser contexts can reject localStorage.
  }
}

export type VoiceoverGapTimer = {
  start: (delayMs: number, onComplete: () => void) => void;
  pause: () => number;
  resume: () => void;
  cancel: () => void;
  getRemainingMs: () => number;
};

type VoiceoverGapTimerApi = {
  setTimeout: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
};

export function createVoiceoverGapTimer(timerApi: VoiceoverGapTimerApi = {
  setTimeout: (handler, timeout) => setTimeout(handler, timeout),
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => Date.now(),
}): VoiceoverGapTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let remainingMs = 0;
  let deadlineMs = 0;
  let onComplete: (() => void) | null = null;
  const now = timerApi.now ?? (() => Date.now());

  function finish(): void {
    timer = null;
    remainingMs = 0;
    const callback = onComplete;
    onComplete = null;
    callback?.();
  }

  function schedule(): void {
    if (remainingMs <= 0) {
      finish();
      return;
    }
    deadlineMs = now() + remainingMs;
    timer = timerApi.setTimeout(finish, remainingMs);
  }

  return {
    start(delayMs, callback) {
      if (timer !== null) timerApi.clearTimeout(timer);
      timer = null;
      remainingMs = Math.max(0, Math.round(delayMs));
      onComplete = callback;
      schedule();
    },
    pause() {
      if (timer !== null) {
        remainingMs = Math.max(0, deadlineMs - now());
        timerApi.clearTimeout(timer);
        timer = null;
      }
      return remainingMs;
    },
    resume() {
      if (timer === null && remainingMs > 0 && onComplete) schedule();
    },
    cancel() {
      if (timer !== null) timerApi.clearTimeout(timer);
      timer = null;
      remainingMs = 0;
      onComplete = null;
    },
    getRemainingMs() {
      if (timer !== null) return Math.max(0, deadlineMs - now());
      return remainingMs;
    },
  };
}

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
