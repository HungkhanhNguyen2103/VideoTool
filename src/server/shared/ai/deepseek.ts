import OpenAI from 'openai';
import type { AiClient, ChatMessage } from './types';
import { logger } from '../logger';
import { aiRequestTimeoutMs, missingAiKeyError, normalizeAiError, withAiRequestTimeout } from './errors';

const MODEL = 'deepseek-chat';

export function createDeepSeekClient(): AiClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) logger.warn('DEEPSEEK_API_KEY is not configured. DeepSeek calls will fail until it is set.');
  const timeoutMs = aiRequestTimeoutMs();
  const client = new OpenAI({ apiKey: apiKey || 'missing-deepseek-key', baseURL: 'https://api.deepseek.com', timeout: timeoutMs, maxRetries: 1 });

  return {
    model: MODEL,

    async chat(messages: ChatMessage[], opts = {}) {
      if (!apiKey) throw missingAiKeyError('DEEPSEEK_API_KEY');
      try {
        const response = await withAiRequestTimeout(() => client.chat.completions.create({
          model: MODEL,
          messages,
          max_tokens: opts.maxTokens,
          ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
          ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
        }), timeoutMs);
        return response.choices[0]?.message?.content ?? '';
      } catch (error) {
        throw normalizeAiError('DeepSeek', error);
      }
    },

    async *stream(messages: ChatMessage[], opts = {}) {
      if (!apiKey) throw missingAiKeyError('DEEPSEEK_API_KEY');
      try {
        const response = await withAiRequestTimeout(() => client.chat.completions.create({
          model: MODEL,
          messages,
          max_tokens: opts.maxTokens,
          stream: true,
        }, { signal: opts.signal }), timeoutMs);
        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) yield text;
        }
      } catch (error) {
        throw normalizeAiError('DeepSeek', error);
      }
    },
  };
}
