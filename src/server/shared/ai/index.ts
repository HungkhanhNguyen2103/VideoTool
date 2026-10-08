import type { AiProvider } from '../../../contracts/project';
import { getDefaultAiModelId, isAiModelForProvider } from '../../../contracts/ai-models';
import { AppError } from '../errors';
import { createClaudeClient } from './claude';
import { createDeepSeekClient } from './deepseek';
import type { AiClient, ChatMessage } from './types';

const clients = new Map<string, AiClient>();

export function getAiClient(provider: AiProvider, requestedModel?: string): AiClient {
  const model = requestedModel ?? getDefaultAiModelId(provider);
  if (!isAiModelForProvider(provider, model)) {
    throw new AppError(`Model ${model} không còn khả dụng hoặc không thuộc ${provider}; hãy chọn model khác.`, 422, 'AI_MODEL_UNAVAILABLE');
  }
  const key = `${provider}:${model}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = provider === 'claude' ? createClaudeClient(model) : createDeepSeekClient(model);
  clients.set(key, client);
  return client;
}

export type { AiClient, AiProvider, ChatMessage };
