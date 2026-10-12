import { describe, expect, it } from 'vitest';
import { hashNarration } from '../../../contracts/name-keywords';
import { isVoiceoverFresh } from '../../../contracts/voiceover';
import {
  audioUrlWithCacheBust,
  shouldToggleVoiceoverOnSpace,
  voiceoverListenReducer,
  voiceoverSceneStatus,
  type VoiceoverListenState,
} from './voiceover-listen';

const project = { voiceoverVoice: 'vi-female', voiceSpeed: 1 };
const readyScene = { narration: 'Narration', audioFileId: 'file-1', voiceoverInput: { voice: 'vi-female', speed: 1, narrationHash: hashNarration('Narration') } };

describe('voiceover listen state', () => {
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
});
