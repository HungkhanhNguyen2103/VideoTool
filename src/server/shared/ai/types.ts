export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface AiClient {
  chat(messages: ChatMessage[], opts?: { maxTokens?: number; json?: boolean }): Promise<string>;
  stream(
    messages: ChatMessage[],
    opts?: { maxTokens?: number; signal?: AbortSignal },
  ): AsyncIterable<string>;
}
