import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AiModelSelect, aiModelForProviderChange } from './AiModelSelect';

describe('AI model selector', () => {
  it('shows models for the selected provider with hints and the dashboard cost note', () => {
    const markup = renderToStaticMarkup(createElement(AiModelSelect, {
      provider: 'claude',
      value: 'claude-sonnet-5-5',
      onChange: vi.fn(),
    }));

    expect(markup).toContain('aria-label="Model AI"');
    expect(markup).toContain('Claude Sonnet 5.5 — cân bằng');
    expect(markup).toContain('claude-opus-4-5');
    expect(markup).not.toContain('deepseek-flash');
    expect(markup).toContain('Chi phí xem trên dashboard của Claude/DeepSeek.');
  });

  it('uses the new provider default when the provider changes', () => {
    expect(aiModelForProviderChange('deepseek', 'claude', 'claude-sonnet-5-5')).toBe('deepseek-chat');
    expect(aiModelForProviderChange('claude', 'deepseek', 'deepseek-flash')).toBe('claude-opus-4-5');
    expect(aiModelForProviderChange('deepseek', 'deepseek', 'deepseek-retired')).toBe('deepseek-chat');
  });

  it('hides the model selector in manual JSON mode', () => {
    const markup = renderToStaticMarkup(createElement(AiModelSelect, {
      provider: 'deepseek',
      value: 'deepseek-chat',
      mode: 'manual',
      onChange: vi.fn(),
    }));

    expect(markup).not.toContain('Model AI');
    expect(markup).not.toContain('dashboard');
  });

  it('disables the selector while its screen is busy', () => {
    const markup = renderToStaticMarkup(createElement(AiModelSelect, {
      provider: 'deepseek',
      value: 'deepseek-chat',
      disabled: true,
      onChange: vi.fn(),
    }));

    expect(markup).toContain('aria-label="Model AI"');
    expect(markup).toContain('disabled=""');
  });
});
