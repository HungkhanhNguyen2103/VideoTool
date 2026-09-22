import type { AiProvider } from '../../../contracts/project';
import { createClaudeClient } from './claude';
import { createDeepSeekClient } from './deepseek';
import type { AiClient, ChatMessage } from './types';

const clients = new Map<AiProvider, AiClient>();

export function getAiClient(provider: AiProvider): AiClient {
  const existing = clients.get(provider);
  if (existing) return existing;
  const client = provider === 'claude' ? createClaudeClient() : createDeepSeekClient();
  clients.set(provider, client);
  return client;
}

export type { AiClient, AiProvider, ChatMessage };
