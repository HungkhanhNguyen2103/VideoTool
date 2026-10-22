import { describe, expect, it } from 'vitest';
import { AI_MODEL_REGISTRY, getDefaultAiModelId, isAiModelForProvider } from './ai-models';

describe('AI model registry', () => {
  it.each(['deepseek', 'claude'] as const)('includes the %s default in its allowed model list', (provider) => {
    const registry = AI_MODEL_REGISTRY[provider];
    expect(registry.models.map((model) => model.id)).toContain(registry.defaultModelId);
  });

  it('keeps the live-verified legacy DeepSeek model as the default', () => {
    expect(getDefaultAiModelId('deepseek')).toBe('deepseek-chat');
    expect(isAiModelForProvider('deepseek', 'deepseek-chat')).toBe(true);
  });

  it('rejects a model belonging to another provider', () => {
    expect(isAiModelForProvider('claude', 'deepseek-flash')).toBe(false);
    expect(isAiModelForProvider('deepseek', 'claude-opus-4-5')).toBe(false);
    expect(isAiModelForProvider('deepseek', 'deepseek-retired')).toBe(false);
  });

  it('accepts the Claude Haiku 5.5 CLI option and rejects unknown model IDs', () => {
    expect(isAiModelForProvider('claude', 'claude-haiku-5-5')).toBe(true);
    expect(isAiModelForProvider('claude', 'claude-haiku-5-6')).toBe(false);
    expect(AI_MODEL_REGISTRY.claude.models.find((model) => model.id === 'claude-haiku-5-5')).toMatchObject({
      label: 'Claude Haiku 5.5', hint: 'rẻ',
      capabilities: { supportsTemperature: true, supportsJsonMode: true, maxOutputTokens: 64_000 },
    });
  });

  it('records model parameter and output limits in the registry', () => {
    expect(AI_MODEL_REGISTRY.deepseek.models.find((model) => model.id === 'deepseek-flash')?.capabilities)
      .toEqual({ supportsTemperature: false, supportsJsonMode: true, maxOutputTokens: 384_000 });
    expect(AI_MODEL_REGISTRY.claude.models.find((model) => model.id === 'claude-sonnet-5-5')?.capabilities)
      .toEqual({ supportsTemperature: false, supportsJsonMode: true, maxOutputTokens: 128_000 });
  });
});
