import OpenAI from 'openai';
import type { AiClient, ChatMessage } from './types';
import { logger } from '../logger';

const MODEL = 'deepseek-chat';

export function createDeepSeekClient(): AiClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) logger.warn('DEEPSEEK_API_KEY is not configured. DeepSeek calls will fail until it is set.');
  const client = new OpenAI({ apiKey: apiKey || 'missing-deepseek-key', baseURL: 'https://api.deepseek.com' });

  return {
    async chat(messages: ChatMessage[], opts = {}) {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages,
        max_tokens: opts.maxTokens,
      });
      return response.choices[0]?.message?.content ?? '';
    },

    async *stream(messages: ChatMessage[], opts = {}) {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages,
        max_tokens: opts.maxTokens,
        stream: true,
      }, { signal: opts.signal });
      for await (const chunk of response) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield text;
      }
    },
  };
}
