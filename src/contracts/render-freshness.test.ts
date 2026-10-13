import { describe, expect, it } from 'vitest';
import type { ProjectDetail } from './project';
import { isRenderStale } from './render-freshness';

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'project-1',
    renderFileId: 'render-1',
    renderedActiveSceneIds: ['scene-1', 'scene-3'],
    scenes: [
      { id: 'scene-1', active: true },
      { id: 'scene-2', active: false },
      { id: 'scene-3', active: true },
    ],
    ...overrides,
  } as ProjectDetail;
}

describe('render freshness', () => {
  it('compares the ordered active scene ids saved with the final render', () => {
    expect(isRenderStale(project())).toBe(false);
    expect(isRenderStale(project({ scenes: [{ id: 'scene-1', active: true }, { id: 'scene-2', active: true }, { id: 'scene-3', active: true }] as ProjectDetail['scenes'] }))).toBe(true);
    expect(isRenderStale(project({ scenes: [{ id: 'scene-3', active: true }, { id: 'scene-1', active: true }] as ProjectDetail['scenes'] }))).toBe(true);
  });

  it('treats legacy projects without a render snapshot as not stale', () => {
    expect(isRenderStale(project({ renderedActiveSceneIds: undefined }))).toBe(false);
    expect(isRenderStale(project({ renderFileId: null, renderedActiveSceneIds: ['scene-1'] }))).toBe(false);
  });
});
