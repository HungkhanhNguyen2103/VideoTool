import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SceneActiveToggle } from './SceneActiveToggle';

describe('SceneActiveToggle', () => {
  it('renders a labeled switch with its current state and detail hint', () => {
    const html = renderToStaticMarkup(<SceneActiveToggle
      active={false}
      disabled={false}
      label="Dùng scene này"
      accessibleName="Dùng scene này"
      hint="Scene tắt sẽ bị bỏ qua khi tạo asset, voice và render. Dữ liệu vẫn được giữ."
      onChange={() => undefined}
    />);

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-label="Dùng scene này"');
    expect(html).toContain('Dùng scene này');
    expect(html).toContain('Scene tắt sẽ bị bỏ qua khi tạo asset, voice và render. Dữ liệu vẫn được giữ.');
  });

  it('toggles exactly once for Space or Enter and ignores repeat and unrelated keys', () => {
    const onChange = vi.fn();
    const element = SceneActiveToggle({ active: true, disabled: false, accessibleName: 'Bật/tắt scene 3', onChange }) as ReactElement<{ children: unknown }>;
    const button = Children.toArray(element.props.children as ReactNode).find((child) => isValidElement(child) && child.type === 'button');
    expect(isValidElement(button)).toBe(true);
    if (!isValidElement(button)) return;
    const props = button.props as { onKeyDown: (event: { key: string; repeat?: boolean; preventDefault: () => void }) => void };
    const spaceEvent = { key: ' ', preventDefault: vi.fn() };
    props.onKeyDown(spaceEvent);
    props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    props.onKeyDown({ key: ' ', repeat: true, preventDefault: vi.fn() });
    props.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() });

    expect(onChange.mock.calls).toEqual([[false], [false]]);
    expect(spaceEvent.preventDefault).toHaveBeenCalledOnce();
  });
});
