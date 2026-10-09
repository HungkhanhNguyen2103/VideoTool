import type { AiProvider } from './project';

export type AiModelCapabilities = {
  supportsTemperature: boolean;
  supportsJsonMode: boolean;
  maxOutputTokens: number;
};

export type AiModelDefinition = {
  id: string;
  label: string;
  hint: string;
  capabilities: AiModelCapabilities;
};

export const AI_MODEL_REGISTRY = {
  deepseek: {
    defaultModelId: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', hint: 'mặc định hiện tại', capabilities: { supportsTemperature: true, supportsJsonMode: true, maxOutputTokens: 384_000 } },
      { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', hint: 'rẻ', capabilities: { supportsTemperature: false, supportsJsonMode: true, maxOutputTokens: 384_000 } },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', hint: 'mạnh nhất', capabilities: { supportsTemperature: false, supportsJsonMode: true, maxOutputTokens: 384_000 } },
    ],
  },
  claude: {
    defaultModelId: 'claude-opus-4-5',
    models: [
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', hint: 'mặc định hiện tại', capabilities: { supportsTemperature: true, supportsJsonMode: true, maxOutputTokens: 64_000 } },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'mạnh nhất', capabilities: { supportsTemperature: false, supportsJsonMode: true, maxOutputTokens: 128_000 } },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'cân bằng', capabilities: { supportsTemperature: false, supportsJsonMode: true, maxOutputTokens: 128_000 } },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', hint: 'rẻ', capabilities: { supportsTemperature: true, supportsJsonMode: true, maxOutputTokens: 64_000 } },
    ],
  },
} as const satisfies Record<AiProvider, { defaultModelId: string; models: readonly AiModelDefinition[] }>;

export type AiModelId = (typeof AI_MODEL_REGISTRY)[AiProvider]['models'][number]['id'];

export function getDefaultAiModelId(provider: AiProvider): AiModelId {
  return AI_MODEL_REGISTRY[provider].defaultModelId as AiModelId;
}

export function isAiModelForProvider(provider: AiProvider, model: string | undefined): model is AiModelId {
  return model !== undefined && AI_MODEL_REGISTRY[provider].models.some((item) => item.id === model);
}

export function getAiModelDefinition(provider: AiProvider, model: string): AiModelDefinition | undefined {
  return AI_MODEL_REGISTRY[provider].models.find((item) => item.id === model);
}
