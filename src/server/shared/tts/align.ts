import { z } from 'zod';
import { loadConfig } from '../../config';

const WhisperResponseSchema = z.object({ words: z.array(z.object({
  word: z.string(), start: z.number(), end: z.number(), probability: z.number(),
})) });

export async function requestWhisperAlignment(audio: Buffer, narration: string): Promise<z.infer<typeof WhisperResponseSchema>['words']> {
  const config = loadConfig();
  const form = new FormData();
  form.set('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'voiceover.wav');
  form.set('text', narration);
  const response = await fetch(config.ALIGN_API_URL, {
    method: 'POST', body: form, signal: AbortSignal.timeout(config.ALIGN_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Whisper alignment HTTP ${response.status}: ${detail.slice(0, 400)}`);
  }
  return WhisperResponseSchema.parse(await response.json()).words;
}
