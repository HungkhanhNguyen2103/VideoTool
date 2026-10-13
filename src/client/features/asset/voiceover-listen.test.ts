import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashNarration } from '../../../contracts/name-keywords';
import { isVoiceoverFresh } from '../../../contracts/voiceover';
import {
  audioUrlWithCacheBust,
  buildVoiceoverListenQueue,
  createVoiceoverGapTimer,
  decideVoiceoverEnd,
  KNOWN_IN_FILE_VOICEOVER_TAIL_SECONDS,
  readVoiceoverAutoAdvancePreference,
  resolveVoiceoverTailSeconds,
  shouldToggleVoiceoverOnSpace,
  voiceoverSceneHasUnappliedTail,
  voiceoverTailWaitSeconds,
  voiceoverListenReducer,
  voiceoverSceneStatus,
  writeVoiceoverAutoAdvancePreference,
  type VoiceoverListenState,
} from './voiceover-listen';

const project = { voiceoverVoice: 'vi-female', voiceSpeed: 1 };
const readyScene = { narration: 'Narration', audioFileId: 'file-1', voiceoverInput: { voice: 'vi-female', speed: 1, narrationHash: hashNarration('Narration') } };

describe('voiceover listen state', () => {
  it('builds an active-only queue and keeps original scene numbers', () => {
    const scenes = [
      { id: 'scene-1', active: true },
      { id: 'scene-2', active: false },
      { id: 'scene-3' },
    ] as never;

    expect(buildVoiceoverListenQueue(scenes)).toEqual([
      { scene: scenes[0], sceneNumber: 1 },
      { scene: scenes[2], sceneNumber: 3 },
    ]);
  });

  it('toggles play/pause, resumes the same scene, and advances to next scene', () => {
    const initial: VoiceoverListenState = { currentIndex: 0, isPlaying: false, blocked: null, reloadVersion: 0 };
    const playing = voiceoverListenReducer(initial, { type: 'toggle-play' });
    expect(playing).toMatchObject({ currentIndex: 0, isPlaying: true });
    expect(voiceoverListenReducer(playing, { type: 'toggle-play' })).toMatchObject({ currentIndex: 0, isPlaying: false });
    expect(voiceoverListenReducer(playing, { type: 'next', sceneCount: 3 })).toMatchObject({ currentIndex: 1, isPlaying: true });
  });

  it('blocks missing and stale voiceovers before playback', () => {
    expect(voiceoverSceneStatus({ narration: 'Narration', audioFileId: null, voiceoverInput: null }, project)).toBe('missing');
    expect(voiceoverSceneStatus({ narration: 'Narration', audioFileId: 'file-1', voiceoverInput: null }, project)).toBe('stale');
    expect(voiceoverSceneStatus({ narration: 'Narration', audioFileId: 'file-1', voiceoverInput: { voice: 'vi-female', speed: 1.2, narrationHash: hashNarration('Narration') } }, project)).toBe('stale');
    expect(voiceoverSceneStatus({ ...readyScene, narration: 'Edited narration' }, project)).toBe('stale');
    expect(isVoiceoverFresh(readyScene, project)).toBe(true);
  });

  it('cache-busts the selected file after regeneration', () => {
    expect(audioUrlWithCacheBust('/files/voice.wav', 0)).toBe('/files/voice.wav');
    expect(audioUrlWithCacheBust('/files/voice.wav', 2)).toBe('/files/voice.wav?voiceoverVersion=2');
  });

  it('only handles Space outside editable controls', () => {
    expect(shouldToggleVoiceoverOnSpace({ key: ' ', target: { tagName: 'DIV' } } as unknown as KeyboardEvent)).toBe(true);
    expect(shouldToggleVoiceoverOnSpace({ key: ' ', target: { tagName: 'INPUT' } } as unknown as KeyboardEvent)).toBe(false);
    expect(shouldToggleVoiceoverOnSpace({ key: ' ', target: { tagName: 'TEXTAREA' } } as unknown as KeyboardEvent)).toBe(false);
    expect(shouldToggleVoiceoverOnSpace({ key: ' ', target: { tagName: 'SELECT' } } as unknown as KeyboardEvent)).toBe(false);
    expect(shouldToggleVoiceoverOnSpace({ key: 'Enter', target: { tagName: 'DIV' } } as unknown as KeyboardEvent)).toBe(false);
  });

  it('decides to advance, stop when disabled, or show completion at the last scene', () => {
    expect(decideVoiceoverEnd({ currentIndex: 0, sceneCount: 3, autoAdvance: true, waitSeconds: 0, nextStatus: 'ready' })).toEqual({ kind: 'advance', nextIndex: 1 });
    expect(decideVoiceoverEnd({ currentIndex: 0, sceneCount: 3, autoAdvance: false, waitSeconds: 0, nextStatus: 'ready' })).toEqual({ kind: 'stop' });
    expect(decideVoiceoverEnd({ currentIndex: 2, sceneCount: 3, autoAdvance: true, waitSeconds: 0, nextStatus: null })).toEqual({ kind: 'finished' });
    expect(decideVoiceoverEnd({ currentIndex: 2, sceneCount: 3, autoAdvance: false, waitSeconds: 0, nextStatus: null })).toEqual({ kind: 'finished' });
  });

  it('pauses at a missing or stale next scene instead of advancing', () => {
    expect(decideVoiceoverEnd({ currentIndex: 0, sceneCount: 2, autoAdvance: true, waitSeconds: 0.8, nextStatus: 'missing' })).toEqual({ kind: 'blocked', reason: 'missing' });
    expect(decideVoiceoverEnd({ currentIndex: 0, sceneCount: 2, autoAdvance: true, waitSeconds: 0.8, nextStatus: 'stale' })).toEqual({ kind: 'blocked', reason: 'stale' });
  });

  it('calculates only the unbaked tail and falls back from empty or invalid input', () => {
    expect(KNOWN_IN_FILE_VOICEOVER_TAIL_SECONDS).toBe(0);
    expect(voiceoverTailWaitSeconds(1)).toBe(1);
    expect(voiceoverTailWaitSeconds(0.2)).toBe(0.2);
    expect(voiceoverTailWaitSeconds(0)).toBe(0);
    expect(voiceoverTailWaitSeconds(0.4)).toBe(0.4);
    expect(resolveVoiceoverTailSeconds('', 0.35)).toBe(0.35);
    expect(resolveVoiceoverTailSeconds('not-a-number', 0.35)).toBe(0.35);
    expect(resolveVoiceoverTailSeconds('1.0', 0.35)).toBe(1);
    expect(voiceoverSceneHasUnappliedTail({ audioFileId: 'file-1', durationSec: 1.2, voiceoverDurationSec: 1 }, 1)).toBe(true);
    expect(voiceoverSceneHasUnappliedTail({ audioFileId: 'file-1', durationSec: 1.2, voiceoverDurationSec: 1 }, 0.2)).toBe(false);
    expect(voiceoverSceneHasUnappliedTail({ audioFileId: null, durationSec: 1.2, voiceoverDurationSec: null }, 1)).toBe(false);
    expect(decideVoiceoverEnd({ currentIndex: 0, sceneCount: 2, autoAdvance: true, waitSeconds: 0.8, nextStatus: 'ready' })).toEqual({ kind: 'wait', nextIndex: 1, waitMs: 800 });
  });

  it('pauses and resumes a gap timer with the remaining duration', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const timer = createVoiceoverGapTimer();
    timer.start(800, onComplete);

    vi.advanceTimersByTime(300);
    expect(timer.pause()).toBe(500);
    vi.advanceTimersByTime(1000);
    expect(onComplete).not.toHaveBeenCalled();

    timer.resume();
    vi.advanceTimersByTime(499);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending gap when navigation or unmount cleanup occurs', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const timer = createVoiceoverGapTimer();
    timer.start(800, onComplete);
    timer.cancel();
    vi.advanceTimersByTime(1000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(timer.getRemainingMs()).toBe(0);
  });

  it('persists the auto-advance preference but tolerates unavailable storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(readVoiceoverAutoAdvancePreference(storage)).toBe(true);
    writeVoiceoverAutoAdvancePreference(false, storage);
    expect(readVoiceoverAutoAdvancePreference(storage)).toBe(false);
    const brokenStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readVoiceoverAutoAdvancePreference(brokenStorage)).toBe(true);
    expect(() => writeVoiceoverAutoAdvancePreference(false, brokenStorage)).not.toThrow();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
