import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChapterRegenModelHelp, ChapterRegenModelSelect } from './ChapterRegenModelSelect';

describe('chapter regeneration model selector', () => {
  it('keeps the shared API selector identifiers and model hints', () => {
    const markup = renderToStaticMarkup(createElement(ChapterRegenModelSelect, {
      mode: 'automatic',
      provider: 'claude',
      model: 'claude-sonnet-5-5',
      cliModel: 'claude-sonnet-5-5',
      onModelChange: vi.fn(),
      onCliModelChange: vi.fn(),
    }));

    expect(markup).toContain('for="ai-model-select"');
    expect(markup).toContain('id="ai-model-select"');
    expect(markup).toContain('aria-label="Model AI"');
    expect(markup).toMatch(/<option value="claude-sonnet-5-5"(?: selected="")?>Claude Sonnet 5\.5 — cân bằng<\/option>/);
  });

  it('restores the stable Claude CLI model field identifiers', () => {
    const markup = renderToStaticMarkup(createElement(ChapterRegenModelSelect, {
      mode: 'cli',
      provider: 'deepseek',
      model: 'deepseek-chat',
      cliModel: 'claude-opus-4-5',
      onModelChange: vi.fn(),
      onCliModelChange: vi.fn(),
    }));

    expect(markup).toContain('for="claude-cli-model"');
    expect(markup).toContain('id="claude-cli-model"');
    expect(markup).toContain('Model Claude CLI');
  });

  it('hides the model field in manual mode', () => {
    const markup = renderToStaticMarkup(createElement(ChapterRegenModelSelect, {
      mode: 'manual',
      provider: 'deepseek',
      model: 'deepseek-chat',
      cliModel: 'claude-sonnet-5-5',
      onModelChange: vi.fn(),
      onCliModelChange: vi.fn(),
    }));

    expect(markup).not.toContain('ai-model-select');
    expect(markup).not.toContain('claude-cli-model');
    expect(markup).not.toContain('Model Claude CLI');
    expect(markup).toContain('<div></div>');
  });

  it('keeps the complete CLI status and reason readable in a title and accessible label', () => {
    const reason = 'Claude CLI chưa sẵn sàng: phiên đăng nhập đã hết hạn và cần mở lại CLI để xác thực.';
    const markup = renderToStaticMarkup(createElement(ChapterRegenModelHelp, {
      text: reason,
      isStatus: true,
      className: 'regenModelHelp',
    }));

    expect(markup).toContain(`title="${reason}"`);
    expect(markup).toContain(`aria-label="${reason}"`);
    expect(markup).toContain('role="status"');
    expect(markup).toContain(reason);
  });
});
