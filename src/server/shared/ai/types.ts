export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type AiChatOptions = { maxTokens?: number; json?: boolean; temperature?: number };
export type AiChatMetadata = { text: string; truncated: boolean };

export interface AiClient {
  readonly model: string;
  chat(messages: ChatMessage[], opts?: AiChatOptions): Promise<string>;
  chatWithMetadata?(messages: ChatMessage[], opts?: AiChatOptions): Promise<AiChatMetadata>;
  stream(
    messages: ChatMessage[],
    opts?: { maxTokens?: number; signal?: AbortSignal },
  ): AsyncIterable<string>;
}
