import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Studio pipeline progress panel', () => {
  it('renders a collapsed percent row and expandable step list', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<details className={styles.pipelineProgress}>');
    expect(source).toContain('Tiến độ pipeline');
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('aria-valuenow={pipelineProgress.percent}');
    expect(source).toContain('pipelineProgress.steps.map');
    expect(source).toContain('{step.done}/{step.total}');
    expect(source).toContain('step.done === step.total && step.total > 0');
  });
});
