import Anthropic from '@anthropic-ai/sdk';
import type { AiClient, ChatMessage } from './types';
import { logger } from '../logger';
import { aiRequestTimeoutMs, missingAiKeyError, normalizeAiError, withAiRequestTimeout } from './errors';
import { getAiModelDefinition, getDefaultAiModelId } from '../../../contracts/ai-models';
const DEFAULT_MAX_TOKENS = 4_096;

function toRequest(model: string, capabilities: { supportsTemperature: boolean; supportsJsonMode: boolean; maxOutputTokens: number }, messages: ChatMessage[], maxTokens: number, temperature?: number, json = false) {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  return {
    model,
    max_tokens: Math.min(maxTokens, capabilities.maxOutputTokens),
    ...(temperature === undefined || !capabilities.supportsTemperature ? {} : { temperature }),
    ...(json && capabilities.supportsJsonMode ? { output_config: { format: { type: 'json_schema' as const, schema: { type: 'object' } } } } : {}),
    ...(system ? { system } : {}),
    messages: messages.filter((message) => message.role !== 'system').map(({ role, content }) => ({ role, content })),
  };
}

export function createClaudeClient(model: string = getDefaultAiModelId('claude')): AiClient {
  const definition = getAiModelDefinition('claude', model);
  if (!definition) throw new Error(`Unsupported Claude model: ${model}`);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) logger.warn('ANTHROPIC_API_KEY is not configured. Claude calls will fail until it is set.');
  const timeoutMs = aiRequestTimeoutMs();
  const client = new Anthropic({ apiKey: apiKey || 'missing-anthropic-key', timeout: timeoutMs, maxRetries: 1 });
  const chatWithMetadata = async (messages: ChatMessage[], opts: Parameters<AiClient['chat']>[1] = {}) => {
    if (!apiKey) throw missingAiKeyError('ANTHROPIC_API_KEY');
    try {
      const response = await withAiRequestTimeout(() => client.messages.create(toRequest(model, definition.capabilities, messages, opts.maxTokens ?? DEFAULT_MAX_TOKENS, opts.temperature, opts.json)), timeoutMs);
      return {
        text: response.content.filter((block) => block.type === 'text').map((block) => block.text).join(''),
        truncated: response.stop_reason === 'max_tokens',
      };
    } catch (error) {
      throw normalizeAiError('Claude', model, error);
    }
  };

  return {
    model,

    async chat(messages: ChatMessage[], opts = {}) {
      return (await chatWithMetadata(messages, opts)).text;
    },

    chatWithMetadata,

    async *stream(messages: ChatMessage[], opts = {}) {
      if (!apiKey) throw missingAiKeyError('ANTHROPIC_API_KEY');
      try {
        const stream = await withAiRequestTimeout(() => Promise.resolve(client.messages.stream(toRequest(model, definition.capabilities, messages, opts.maxTokens ?? DEFAULT_MAX_TOKENS), { signal: opts.signal })), timeoutMs);
        for await (const event of stream) {
          if (event.type !== 'content_block_delta') continue;
          const delta = event.delta as { text?: string; inputDelta?: { text?: string } };
          const text = delta.text ?? delta.inputDelta?.text;
          if (text) yield text;
        }
      } catch (error) {
        throw normalizeAiError('Claude', model, error);
      }
    },
  };
}
