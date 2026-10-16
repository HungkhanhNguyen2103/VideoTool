import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VISUAL_STYLE_IDS, type VisualStyleId } from '../../../../contracts/project';
import { VISUAL_STYLE_PACK_SLOTS, type VisualStylePacks } from '../../../../contracts/visual-style-pack';
import { StylePackPanel, copyStylePackPrompt } from './StylePackPanel';

const image = { url: '/files/wide.png', filename: 'wide.png', source: 'shared' as const, updatedAt: new Date().toISOString() };
const props = (styleId: VisualStyleId, packs: VisualStylePacks = {}) => ({
  styleId, packs, busy: false, onUpload: vi.fn(), onDelete: vi.fn(),
});

function findElement(tree: ReactNode, test: (type: unknown, props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(tree)) return tree.map((child) => findElement(child, test)).find(Boolean);
  if (!isValidElement(tree)) return undefined;
  const elementProps = tree.props as Record<string, unknown>;
  if (test(tree.type, elementProps)) return elementProps;
  return findElement(elementProps.children as ReactNode, test);
}

describe('StylePackPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows five style-specific tiles and swaps them with the style', () => {
    for (const styleId of VISUAL_STYLE_IDS) {
      const html = renderToStaticMarkup(<StylePackPanel {...props(styleId)} />);
      expect((html.match(/data-style-pack-tile=/g) ?? [])).toHaveLength(5);
      for (const slot of VISUAL_STYLE_PACK_SLOTS[styleId]) expect(html).toContain(slot.label);
      expect(html).toContain('0/5 ảnh');
    }
    const map = renderToStaticMarkup(<StylePackPanel {...props('strategic-map')} />);
    expect(map).toContain('Bản đồ 2');
    expect(map).not.toContain('Vật dụng');
  });

  it('shows uploaded images and delete controls, but keeps bundled cinematic fallback non-removable', () => {
    const filled = renderToStaticMarkup(<StylePackPanel {...props('anime', { anime: { wide: image } })} />);
    expect(filled).toContain('1/5 ảnh');
    expect(filled).toContain('/files/wide.png');
    expect(filled).toContain('Thay ảnh');
    expect(filled).toContain('Xóa');
    expect(filled).toContain('download="wide.png"');

    const fallback = renderToStaticMarkup(<StylePackPanel {...props('cinematic')} />);
    expect(fallback).toContain('cinematic');
    expect(fallback).not.toContain('Xóa');
    expect(fallback).toContain('0/5 ảnh');
  });

  it('copies the exact slot prompt and reports confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    const prompt = VISUAL_STYLE_PACK_SLOTS['flat-cartoon'][0]!.prompt;
    await expect(copyStylePackPrompt(prompt, writeText, notify)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(prompt);
    expect(notify).toHaveBeenCalledWith('Đã sao chép prompt');
  });

  it('passes the selected style and slot to upload and delete callbacks', () => {
    const panelProps = props('strategic-map', { 'strategic-map': { map: image } });
    const tree = StylePackPanel(panelProps);
    const fileInput = findElement(tree, (type, p) => type === 'input' && p['data-slot-id'] === 'map')!;
    const file = new File(['image'], 'map.png', { type: 'image/png' });
    (fileInput.onChange as (event: { currentTarget: { files: File[]; value: string } }) => void)({ currentTarget: { files: [file], value: 'map.png' } });
    expect(panelProps.onUpload).toHaveBeenCalledWith('strategic-map', 'map', file);
    const deleteButton = findElement(tree, (type, p) => typeof type === 'function' && p['data-delete-slot'] === 'map')!;
    (deleteButton.onClick as () => void)();
    expect(panelProps.onDelete).toHaveBeenCalledWith('strategic-map', 'map');
  });
});
