import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('NewProjectForm script configuration layout', () => {
  it('aligns duration and chapter controls in the three-column desktop grid', async () => {
    const source = await readFile(new URL('./NewProjectForm.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('./NewProjectForm.module.css', import.meta.url), 'utf8');

    expect(source).toContain('styles.scriptConfigGrid');
    expect(source).toContain('Số chương dự kiến');
    expect(source).toContain('htmlFor="chapters"');
    expect(source).toContain('id="chapters"');
    expect(css).toContain('.scriptConfigGrid {');
    expect(css).toContain('.numericConfigField > label {');
    expect(css).toContain('.scriptConfigGrid { grid-template-columns: minmax(0, 1fr); }');
  });
});
