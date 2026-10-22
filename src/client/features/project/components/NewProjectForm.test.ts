import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('NewProjectForm script configuration layout', () => {
  it('aligns duration and chapter controls in the three-column desktop grid', async () => {
    const source = await readFile(new URL('./NewProjectForm.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('./NewProjectForm.module.css', import.meta.url), 'utf8');

    expect(source).toContain('styles.scriptConfigGrid');
    expect(source).toContain('Số chương dự kiến');
    expect(source).toContain('htmlFor="duration">Thời lượng mục tiêu (giây)</label>');
    expect(source).toContain('id="duration"');
    expect(source).toContain('aria-describedby="duration-err duration-hint"');
    expect(source).toContain('htmlFor="chapters"');
    expect(source).toContain('id="chapters"');
    expect(source).toContain('aria-describedby="chapters-err"');
    expect(css).toContain('.scriptConfigGrid {');
    expect(css).toContain('.numericConfigField > label {');
    expect(css).toContain('.scriptConfigGrid { grid-template-columns: minmax(0, 1fr); }');
  });

  it('keeps idea references empty, shows the research note, and reports a created project for used-status handoff', async () => {
    const source = await readFile(new URL('./NewProjectForm.tsx', import.meta.url), 'utf8');
    const page = await readFile(new URL('../ProjectInitPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if (researchNote) merged.referencesText = \'\';');
    expect(source).toContain('prefillResearchNote &&');
    expect(source).toContain('onProjectCreated?.(project.id)');
    expect(page).toContain('YoutubeIdeaProjectPrefillSchema');
    expect(page).toContain('markYoutubeIdeaUsed(ideaHandoff.channelId, ideaHandoff.ideaId, projectId)');
  });
});
