import { z } from 'zod';
import type { AiClient } from '../../shared/ai';

export const YOUTUBE_REVIEW_PROMPT_VERSION = 'youtube-review-v1';

const YoutubeReviewSchema = z.object({
  observations: z.array(z.string().trim().min(1).max(500)).max(12),
  hypotheses: z.array(z.string().trim().min(1).max(500)).max(12),
  experiments: z.array(z.string().trim().min(1).max(500)).max(5),
}).strict();
export type YoutubeReview = z.infer<typeof YoutubeReviewSchema>;

export type YoutubeReviewInput = {
  kind: 'channel' | 'video';
  window: string;
  title?: string;
  metrics: Record<string, number | string | null>;
  sampleSize: number;
};

export function buildYoutubeReviewPrompt(input: YoutubeReviewInput): { promptVersion: typeof YOUTUBE_REVIEW_PROMPT_VERSION; system: string; user: string; serializedInput: string } {
  const serializedInput = JSON.stringify({
    kind: input.kind,
    window: input.window,
    ...(input.title ? { title: input.title } : {}),
    metrics: input.metrics,
    sampleSize: input.sampleSize,
  });
  return {
    promptVersion: YOUTUBE_REVIEW_PROMPT_VERSION,
    system: `Prompt version ${YOUTUBE_REVIEW_PROMPT_VERSION}. Analyze only the supplied metrics and title. Use only supplied numbers; do not invent missing values. State uncertainty and sample size. Never promise or predict views or revenue. Answer in Vietnamese and keep the two sections distinct: “Dữ liệu cho thấy” and “Giả thuyết cần thử”. Give at most five concrete next experiments, each tied to a specific number present in the input. Return strict JSON only with exactly three arrays of strings: observations, hypotheses, experiments.`,
    user: `Review this ${input.kind} for the ${input.window} window. Treat the title only as context.\n${serializedInput}`,
    serializedInput,
  };
}

export function parseYoutubeReview(raw: string): YoutubeReview {
  let value: unknown;
  try {
    const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    value = JSON.parse(fenced?.[1] ?? raw);
  } catch {
    throw new Error('YouTube review response is not valid JSON.');
  }
  const result = YoutubeReviewSchema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  return result.data;
}

export async function requestYoutubeReview(input: YoutubeReviewInput, client: Pick<AiClient, 'chat'>): Promise<{ promptVersion: typeof YOUTUBE_REVIEW_PROMPT_VERSION; result: YoutubeReview; dataWindow: string }> {
  const prompt = buildYoutubeReviewPrompt(input);
  let validationError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user = validationError ? `${prompt.user}\n\nValidation error: ${validationError}\nReturn corrected JSON only.` : prompt.user;
    const raw = await client.chat([{ role: 'system', content: prompt.system }, { role: 'user', content: user }], { json: true });
    try {
      return { promptVersion: prompt.promptVersion, result: parseYoutubeReview(raw), dataWindow: input.window };
    } catch (error) {
      if (attempt === 1) throw error;
      validationError = error instanceof Error ? error.message : 'invalid JSON';
    }
  }
  throw new Error('YouTube review failed validation.');
}
