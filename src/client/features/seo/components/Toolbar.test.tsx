import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SeoSection } from '../../../../contracts/seo';
import { Toolbar } from './Toolbar';

function renderToolbar(mode: 'automatic' | 'manual') {
  return renderToStaticMarkup(<Toolbar
    mode={mode}
    provider="deepseek"
    model="deepseek-chat"
    backend="api"
    cliModel="claude-sonnet-5-5"
    cliAvailability={{ disabled: false }}
    busy={false}
    sections={['titles', 'description'] as SeoSection[]}
    hasRaw
    onModeChange={() => undefined}
    onProviderChange={() => undefined}
    onModelChange={() => undefined}
    onBackendChange={() => undefined}
    onCliModelChange={() => undefined}
    onGenerate={() => undefined}
    onLoadPrompt={() => undefined}
    onImport={() => undefined}
  />);
}

describe('SEO toolbar', () => {
  it('keeps the mode selector and aligned action row available in manual mode', () => {
    const markup = renderToolbar('manual');

    expect(markup).toContain('Chế độ');
    expect(markup).toContain('Thủ công (JSON)');
    expect(markup).toContain('Sao chép prompt');
    expect(markup).toContain('Nhập JSON');
    expect(markup).toContain('Các phần: 2/6');
    expect(markup).toContain('Tự dán JSON từ AI bất kỳ');
  });
});
