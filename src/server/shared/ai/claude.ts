import Anthropic from '@anthropic-ai/sdk';
import type { AiClient, ChatMessage } from './types';
import { logger } from '../logger';
import { aiRequestTimeoutMs, missingAiKeyError, normalizeAiError, withAiRequestTimeout } from './errors';

const MODEL = 'claude-opus-4-5';
const DEFAULT_MAX_TOKENS = 4_096;

function toRequest(messages: ChatMessage[], maxTokens: number) {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  return {
    model: MODEL,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: messages.filter((message) => message.role !== 'system').map(({ role, content }) => ({ role, content })),
  };
}

export function createClaudeClient(): AiClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) logger.warn('ANTHROPIC_API_KEY is not configured. Claude calls will fail until it is set.');
  const timeoutMs = aiRequestTimeoutMs();
  const client = new Anthropic({ apiKey: apiKey || 'missing-anthropic-key', timeout: timeoutMs, maxRetries: 1 });

  return {
    model: MODEL,

    async chat(messages: ChatMessage[], opts = {}) {
      if (!apiKey) throw missingAiKeyError('ANTHROPIC_API_KEY');
      try {
        const response = await withAiRequestTimeout(() => client.messages.create(toRequest(messages, opts.maxTokens ?? DEFAULT_MAX_TOKENS)), timeoutMs);
        return response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
      } catch (error) {
        throw normalizeAiError('Claude', error);
      }
    },

    async *stream(messages: ChatMessage[], opts = {}) {
      if (!apiKey) throw missingAiKeyError('ANTHROPIC_API_KEY');
      try {
        const stream = await withAiRequestTimeout(() => Promise.resolve(client.messages.stream(toRequest(messages, opts.maxTokens ?? DEFAULT_MAX_TOKENS), { signal: opts.signal })), timeoutMs);
        for await (const event of stream) {
          if (event.type !== 'content_block_delta') continue;
          const delta = event.delta as { text?: string; inputDelta?: { text?: string } };
          const text = delta.text ?? delta.inputDelta?.text;
          if (text) yield text;
        }
      } catch (error) {
        throw normalizeAiError('Claude', error);
      }
    },
  };
}
