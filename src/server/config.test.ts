import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('applies defaults for an empty env', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      PORT: 3000,
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DB: 'video_tool',
      FILES_DIR: './data/files',
      CLAUDE_CLI_PATH: 'claude',
      CLAUDE_CLI_TIMEOUT_MS: 600_000,
      CLAUDE_CLI_MAX_OUTPUT_BYTES: 2_000_000,
      WORKER_POLL_MS: 2000,
      AI_REQUEST_TIMEOUT_MS: 120000,
      REMOTION_CRF: 22,
      NODE_ENV: 'development',
      TTS_API_URL: 'http://127.0.0.1:8000/api/tts',
      TTS_DEFAULT_VOICE: 'Truc Ly',
      TTS_REF_AUDIO_PATH: './lib/speech/audio.WAV',
      TTS_REF_AUDIO_TEXT: 'Ai cũng biết Quang Trung là người đánh tan 29 vạn quân Thanh chỉ trong 5 ngày tết.',
      TTS_TIMEOUT_MS: 60000,
      DEPTH_API_URL: 'http://127.0.0.1:8000/api/depth',
      DEPTH_TIMEOUT_MS: 120000,
      FFMPEG_PATH: 'ffmpeg',
      FFPROBE_PATH: 'ffprobe',
      FREESOUND_API_KEY: '',
    });
  });

  it('coerces numeric strings', () => {
    expect(loadConfig({ PORT: '4100', WORKER_POLL_MS: '500', AI_REQUEST_TIMEOUT_MS: '3210' })).toMatchObject({ PORT: 4100, WORKER_POLL_MS: 500, AI_REQUEST_TIMEOUT_MS: 3210 });
  });

  it('fails fast with a readable message', () => {
    expect(() => loadConfig({ PORT: 'abc', WORKER_POLL_MS: '5' })).toThrowError(ConfigError);
    expect(() => loadConfig({ PORT: 'abc' })).toThrowError(/PORT/);
  });

  it('validates the optional Remotion concurrency override', () => {
    expect(loadConfig({ REMOTION_CONCURRENCY: '' }).REMOTION_CONCURRENCY).toBeUndefined();
    expect(loadConfig({ REMOTION_CONCURRENCY: '3' }).REMOTION_CONCURRENCY).toBe(3);
    expect(() => loadConfig({ REMOTION_CONCURRENCY: '0' })).toThrowError(ConfigError);
    expect(() => loadConfig({ REMOTION_CONCURRENCY: '1.5' })).toThrowError(ConfigError);
    expect(() => loadConfig({ REMOTION_CONCURRENCY: 'not-a-number' })).toThrowError(ConfigError);
  });

  it('uses the Remotion H.264 CRF default for missing or invalid overrides', () => {
    expect(loadConfig({ REMOTION_CRF: '28' }).REMOTION_CRF).toBe(28);
    expect(loadConfig({ REMOTION_CRF: '' }).REMOTION_CRF).toBe(22);
    expect(loadConfig({ REMOTION_CRF: '52' }).REMOTION_CRF).toBe(22);
    expect(loadConfig({ REMOTION_CRF: 'not-a-number' }).REMOTION_CRF).toBe(22);
  });

  it('accepts explicit Claude CLI settings and rejects non-positive limits', () => {
    expect(loadConfig({ CLAUDE_CLI_PATH: 'C:\\tools\\claude.exe', CLAUDE_CLI_TIMEOUT_MS: '12345', CLAUDE_CLI_MAX_OUTPUT_BYTES: '4096' }))
      .toMatchObject({ CLAUDE_CLI_PATH: 'C:\\tools\\claude.exe', CLAUDE_CLI_TIMEOUT_MS: 12_345, CLAUDE_CLI_MAX_OUTPUT_BYTES: 4_096 });
    expect(() => loadConfig({ CLAUDE_CLI_TIMEOUT_MS: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ CLAUDE_CLI_MAX_OUTPUT_BYTES: '0' })).toThrow(ConfigError);
  });
});
