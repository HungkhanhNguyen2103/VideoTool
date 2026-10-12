import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Scene } from '../../../contracts/project';
import { hashNarration } from '../../../contracts/name-keywords';
import { VoiceoverListenPanel } from './VoiceoverListenPanel';
import { audioUrlWithCacheBust, resetVoiceoverAudio, syncVoiceoverAudio, type VoiceoverAudioPort } from './voiceover-listen';

const scene = (id: string, narration: string, audioFileId: string | null, speed = 1): Scene => ({
  id,
  narration,
  visualPrompt: '',
  durationSec: 2,
  assetType: 'image',
  assetFileId: null,
  audioFileId,
  voiceoverDurationSec: audioFileId ? 1.8 : null,
  voiceoverInput: audioFileId ? { voice: 'vi-female', speed, narrationHash: hashNarration(narration) } : null,
  wordTimings: null,
  sfxPrompt: '',
  motionPrompt: '',
  sfxFileId: null,
  videoKeyframeFileId: null,
  videoTailFileId: null,
  videoDurationSec: null,
  depthMap: null,
  nameCandidates: null,
});

describe('VoiceoverListenPanel integration wiring', () => {
  it('renders the selected audio with the regeneration cache bust and scene statuses', () => {
    const html = renderToStaticMarkup(createElement(VoiceoverListenPanel, {
      scenes: [scene('scene-1', 'First narration', 'voice-1'), scene('scene-2', 'Second narration', 'voice-2', 1.2)],
      project: { voiceoverVoice: 'vi-female', voiceSpeed: 1 },
      audioUrls: { 'scene-1': '/files/voice-1.wav', 'scene-2': '/files/voice-2.wav' },
      reloadVersions: { 'scene-1': 2 },
      onRegenerate: async () => true,
    }));

    expect(html).toContain('src="/files/voice-1.wav?voiceoverVersion=2"');
    expect(html).toContain('First narration');
    expect(html).toContain('green');
    expect(html).toContain('amber');
  });

  it('keeps the paused position while toggling playback and resets only for a regenerated source', async () => {
    const calls: string[] = [];
    const audio: VoiceoverAudioPort = {
      currentTime: 0,
      pause: () => calls.push('pause'),
      load: () => calls.push('load'),
      play: async () => { calls.push('play'); },
    };
    const input = { isPlaying: false, status: 'ready' as const, hasSource: true, onBlocked: () => undefined, onAutoplayRejected: () => undefined };
    audio.currentTime = 0.42;
    await expect(syncVoiceoverAudio(audio, input)).resolves.toBe('idle');
    expect(audio.currentTime).toBe(0.42);
    await expect(syncVoiceoverAudio(audio, { ...input, isPlaying: true })).resolves.toBe('playing');
    expect(calls).toEqual(['pause', 'play']);

    resetVoiceoverAudio(audio, audioUrlWithCacheBust('/files/voice.wav', 2));
    expect(audio.currentTime).toBe(0);
    expect(calls.at(-2)).toBe('pause');
    expect(calls.at(-1)).toBe('load');
  });

  it('auto-pauses missing/stale scenes and exposes rejected autoplay to the component state', async () => {
    const calls: string[] = [];
    const audio: VoiceoverAudioPort = {
      currentTime: 0,
      pause: () => calls.push('pause'),
      load: () => undefined,
      play: async () => { throw new Error('autoplay blocked'); },
    };
    const blocked: string[] = [];
    await expect(syncVoiceoverAudio(audio, { isPlaying: true, status: 'missing', hasSource: false, onBlocked: (status) => blocked.push(status), onAutoplayRejected: () => undefined })).resolves.toBe('blocked');
    await expect(syncVoiceoverAudio(audio, { isPlaying: true, status: 'stale', hasSource: true, onBlocked: (status) => blocked.push(status), onAutoplayRejected: () => undefined })).resolves.toBe('blocked');
    let rejected = false;
    await expect(syncVoiceoverAudio(audio, { isPlaying: true, status: 'ready', hasSource: true, onBlocked: () => undefined, onAutoplayRejected: () => { rejected = true; } })).resolves.toBe('autoplay-error');
    expect(blocked).toEqual(['missing', 'stale']);
    expect(rejected).toBe(true);
    expect(calls).toEqual(['pause', 'pause']);
  });
});
