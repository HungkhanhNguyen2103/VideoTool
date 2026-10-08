import OpenAI from 'openai';
import type { AiClient, ChatMessage } from './types';
import { logger } from '../logger';
import { aiRequestTimeoutMs, missingAiKeyError, normalizeAiError, withAiRequestTimeout } from './errors';
import { getAiModelDefinition, getDefaultAiModelId } from '../../../contracts/ai-models';
import type { AiProvider } from '../../../contracts/project';

export function createDeepSeekClient(model: string = getDefaultAiModelId('deepseek')): AiClient {
  const definition = getAiModelDefinition('deepseek' satisfies AiProvider, model);
  if (!definition) throw new Error(`Unsupported DeepSeek model: ${model}`);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) logger.warn('DEEPSEEK_API_KEY is not configured. DeepSeek calls will fail until it is set.');
  const timeoutMs = aiRequestTimeoutMs();
  const client = new OpenAI({ apiKey: apiKey || 'missing-deepseek-key', baseURL: 'https://api.deepseek.com', timeout: timeoutMs, maxRetries: 1 });

  return {
    model,

    async chat(messages: ChatMessage[], opts = {}) {
      if (!apiKey) throw missingAiKeyError('DEEPSEEK_API_KEY');
      try {
        const response = await withAiRequestTimeout(() => client.chat.completions.create({
          model,
          messages,
          max_tokens: opts.maxTokens === undefined ? undefined : Math.min(opts.maxTokens, definition.capabilities.maxOutputTokens),
          ...(opts.temperature === undefined || !definition.capabilities.supportsTemperature ? {} : { temperature: opts.temperature }),
          ...(opts.json && definition.capabilities.supportsJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        }), timeoutMs);
        return response.choices[0]?.message?.content ?? '';
      } catch (error) {
        throw normalizeAiError('DeepSeek', model, error);
      }
    },

    async *stream(messages: ChatMessage[], opts = {}) {
      if (!apiKey) throw missingAiKeyError('DEEPSEEK_API_KEY');
      try {
        const response = await withAiRequestTimeout(() => client.chat.completions.create({
          model,
          messages,
          max_tokens: opts.maxTokens === undefined ? undefined : Math.min(opts.maxTokens, definition.capabilities.maxOutputTokens),
          stream: true,
        }, { signal: opts.signal }), timeoutMs);
        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) yield text;
        }
      } catch (error) {
        throw normalizeAiError('DeepSeek', model, error);
      }
    },
  };
}
