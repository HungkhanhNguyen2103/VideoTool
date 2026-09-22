import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { createVieneuClient } from './vieneu';
import { masterAudio, probeAudioDuration } from './mastering';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('VieNeu TTS client', () => {
  it('posts the configured voice and synthesis options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('wav'), { status: 200, headers: { 'content-type': 'audio/wav' } }));
    const client = createVieneuClient({ apiUrl: 'http://tts.test/api/tts', defaultVoice: 'Truc Ly', timeoutMs: 60_000, fetchImpl: fetchMock });

    await expect(client.synthesize('Xin chào', { speed: 1.2, temperature: 0.4 })).resolves.toEqual(Buffer.from('wav'));

    expect(fetchMock).toHaveBeenCalledWith('http://tts.test/api/tts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'Xin chào', voice: 'Truc Ly', ref_audio_path: null, ref_audio_text: null, speed: 1.2, temperature: 0.4 }),
    }));
  });

  it('retries once after a failed request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(new Response(Buffer.from('wav'), { status: 200 }));
    const client = createVieneuClient({ apiUrl: 'http://tts.test/api/tts', defaultVoice: 'Truc Ly', timeoutMs: 60_000, fetchImpl: fetchMock, sleep: async () => undefined });

    await expect(client.synthesize('retry')).resolves.toEqual(Buffer.from('wav'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps exhausted retries to TTS_REQUEST_FAILED', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    const client = createVieneuClient({ apiUrl: 'http://tts.test/api/tts', defaultVoice: 'Truc Ly', timeoutMs: 60_000, fetchImpl: fetchMock, sleep: async () => undefined });

    await expect(client.synthesize('offline')).rejects.toMatchObject({ code: 'TTS_REQUEST_FAILED', status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('audio mastering and probing', () => {
  it('falls back to the unmastered buffer when ffmpeg mastering fails', async () => {
    const spawnMock = vi.mocked(spawn).mockImplementation(() => {
      const process = new EventEmitter();
      queueMicrotask(() => process.emit('error', new Error('ffmpeg missing')));
      return process as never;
    });

    await expect(masterAudio(Buffer.from('raw-wav'))).resolves.toEqual(Buffer.from('raw-wav'));
    expect(spawnMock).toHaveBeenCalled();
  });

  it('reads duration from ffprobe output', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const process = new EventEmitter();
      const stdout = new EventEmitter();
      Object.assign(process, { stdout, stderr: new EventEmitter() });
      queueMicrotask(() => { stdout.emit('data', Buffer.from('7.21\n')); process.emit('close', 0); });
      return process as never;
    });

    await expect(probeAudioDuration(Buffer.from('wav'))).resolves.toBe(7.21);
  });
});
