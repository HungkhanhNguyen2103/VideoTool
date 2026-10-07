import { describe, expect, it, vi } from 'vitest';
import { normalizeSfxForRender, type FfmpegCaptureRunner } from './sfx-audio';

describe('SFX render-time loudness normalization', () => {
  it('uses measured loudnorm data for clips at least three seconds and writes a normalized temporary WAV', async () => {
    const runner = vi.fn<FfmpegCaptureRunner>()
      .mockResolvedValueOnce({ stdout: '4.25', stderr: '' })
      .mockResolvedValueOnce({ stdout: '2', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '{\n"input_i" : "-22.0",\n"input_tp" : "-3.0",\n"input_lra" : "4.0",\n"input_thresh" : "-32.0",\n"target_offset" : "0.0"\n}' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    await normalizeSfxForRender({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', inputPath: 'stored.mp3', outputPath: 'tmp.wav', runner });

    expect(runner).toHaveBeenCalledTimes(4);
    expect(runner.mock.calls[3]?.[1].join(' ')).toContain('loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-22:measured_TP=-3:measured_LRA=4:measured_thresh=-32:offset=0:linear=true');
    expect(runner.mock.calls[3]?.[1].join(' ')).toContain('pan=stereo|c0=c0|c1=c1');
    expect(runner.mock.calls[3]?.[1]).toContain('tmp.wav');
  });

  it('uses ebur128 measured gain plus a true-peak limiter for clips shorter than three seconds', async () => {
    const runner = vi.fn<FfmpegCaptureRunner>()
      .mockResolvedValueOnce({ stdout: '2.2', stderr: '' })
      .mockResolvedValueOnce({ stdout: '1', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: 't: 0.1 I: -70.0 LUFS\nt: 2.2 I: -20.5 LUFS\nIntegrated loudness:\nI: -20.5 LUFS' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    await normalizeSfxForRender({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', inputPath: 'stored.mp3', outputPath: 'tmp.wav', runner });

    expect(runner.mock.calls[2]?.[1].join(' ')).toContain('pan=stereo|c0=c0|c1=c0,ebur128=peak=true');
    expect(runner.mock.calls[3]?.[1].join(' ')).toContain('pan=stereo|c0=c0|c1=c0,volume=4.5dB,aresample=192000,alimiter=limit=0.841395:level=false,aresample=48000');
  });

  it('never edits the source file and rejects when loudness cannot be measured', async () => {
    const runner = vi.fn<FfmpegCaptureRunner>()
      .mockResolvedValueOnce({ stdout: '2.2', stderr: '' })
      .mockResolvedValueOnce({ stdout: '1', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: 'Integrated loudness: I: -inf LUFS' });
    await expect(normalizeSfxForRender({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', inputPath: 'source.mp3', outputPath: 'copy.wav', runner })).rejects.toThrow(/measure/i);
    expect(runner.mock.calls.map((call) => call[1])).not.toContainEqual(expect.arrayContaining(['-y', 'source.mp3']));
  });
});
