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
      WORKER_POLL_MS: 2000,
      NODE_ENV: 'development',
      TTS_API_URL: 'http://127.0.0.1:8000/api/tts',
      TTS_DEFAULT_VOICE: 'Truc Ly',
      TTS_TIMEOUT_MS: 60000,
      FFMPEG_PATH: 'ffmpeg',
      FFPROBE_PATH: 'ffprobe',
      FREESOUND_API_KEY: '',
    });
  });

  it('coerces numeric strings', () => {
    expect(loadConfig({ PORT: '4100', WORKER_POLL_MS: '500' })).toMatchObject({ PORT: 4100, WORKER_POLL_MS: 500 });
  });

  it('fails fast with a readable message', () => {
    expect(() => loadConfig({ PORT: 'abc', WORKER_POLL_MS: '5' })).toThrowError(ConfigError);
    expect(() => loadConfig({ PORT: 'abc' })).toThrowError(/PORT/);
  });
});
