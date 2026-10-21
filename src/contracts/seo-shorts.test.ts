import { describe, expect, it } from 'vitest';
import type { ProjectDetail } from './project';
import { pickShortsWindows } from './seo-shorts';

type SceneInput = { id: string; durationSec: number; active?: boolean };
type ChapterInput = { no: number; title?: string; scenesCount: number; role?: 'hook' | 'context' | 'rising' | 'climax' | 'resolution' | null };

function project(scenes: SceneInput[], chapters: ChapterInput[], fps = 30): Pick<ProjectDetail, 'chapters' | 'scenes' | 'renderSettings'> {
  return {
    scenes: scenes.map(({ id, durationSec, active = true }) => ({ id, narration: `Narration ${id}`, durationSec, active })),
    chapters: chapters.map(({ no, title = `Chapter ${no}`, scenesCount, role = null }) => ({ no, title, scenesCount, role })),
    renderSettings: { fps },
  } as unknown as Pick<ProjectDetail, 'chapters' | 'scenes' | 'renderSettings'>;
}

describe('pickShortsWindows', () => {
  it('compacts inactive scenes and keeps every selected cut on active scene boundaries', () => {
    const result = pickShortsWindows(project([
      { id: 'a', durationSec: 20 },
      { id: 'off', durationSec: 40, active: false },
      { id: 'b', durationSec: 15 },
      { id: 'c', durationSec: 15 },
    ], [{ no: 1, scenesCount: 4, role: 'climax' }]));

    expect(result.windows).toEqual([expect.objectContaining({
      id: 'short-a', startSec: 0, endSec: 50, chapterNo: 1, sceneIds: ['a', 'b', 'c'],
      sceneStartIndex: 0, sceneEndIndex: 2,
    })]);
  });

  it.each([
    [30, true],
    [55, true],
    [55.04, false],
  ])('accepts a single scene duration of %s seconds only when it is within policy bounds', (duration, eligible) => {
    const result = pickShortsWindows(project([{ id: 'one', durationSec: duration }], [{ no: 1, scenesCount: 1 }]));
    expect(result.windows.length > 0).toBe(eligible);
    if (eligible) expect(result.windows[0]).toMatchObject({ startSec: 0, endSec: duration, sceneIds: ['one'] });
  });

  it('returns at most three non-overlapping windows', () => {
    const result = pickShortsWindows(project(
      Array.from({ length: 15 }, (_, index) => ({ id: `s${index + 1}`, durationSec: 10 })),
      [{ no: 1, scenesCount: 15, role: 'climax' }],
    ));

    expect(result.windows.length).toBeLessThanOrEqual(3);
    const ordered = [...result.windows].sort((a, b) => a.startSec - b.startSec);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]!.startSec).toBeGreaterThanOrEqual(ordered[index - 1]!.endSec);
    }
  });

  it('returns no window when the active video is shorter than 30 seconds', () => {
    const result = pickShortsWindows(project([
      { id: 'a', durationSec: 15 },
      { id: 'off', durationSec: 60, active: false },
      { id: 'b', durationSec: 14 },
    ], [{ no: 1, scenesCount: 3 }]));
    expect(result.windows).toEqual([]);
  });

  it('uses the longest active chapter as target when no climax role exists', () => {
    const result = pickShortsWindows(project(
      [...Array.from({ length: 2 }, (_, index) => ({ id: `early-${index}`, durationSec: 10 })),
        ...Array.from({ length: 5 }, (_, index) => ({ id: `long-${index}`, durationSec: 10 }))],
      [{ no: 1, scenesCount: 2, role: null }, { no: 2, scenesCount: 5, role: 'rising' }],
    ));
    expect(result.windows[0]?.chapterNo).toBe(2);
  });

  it('ranks a climax-contained window above a closer non-climax window', () => {
    const result = pickShortsWindows(project(
      Array.from({ length: 15 }, (_, index) => ({ id: `s${index + 1}`, durationSec: 10 })),
      [
        { no: 1, scenesCount: 3, role: 'context' },
        { no: 2, scenesCount: 6, role: 'climax' },
        { no: 3, scenesCount: 6, role: 'resolution' },
      ],
    ));
    expect(result.windows[0]?.chapterNo).toBe(2);
  });

  it('returns a Vietnamese warning instead of guessing when chapter scene counts mismatch', () => {
    const result = pickShortsWindows(project(
      [{ id: 'a', durationSec: 40 }],
      [{ no: 1, scenesCount: 0 }],
    ));
    expect(result.windows).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/khớp|khong khop/i);
  });

  it('is deterministic and tolerates legacy null chapter roles', () => {
    const input = project(
      Array.from({ length: 8 }, (_, index) => ({ id: `s${index + 1}`, durationSec: 10 })),
      [{ no: 1, scenesCount: 8, role: null }],
    );
    expect(pickShortsWindows(input)).toEqual(pickShortsWindows(input));
    expect(pickShortsWindows(input).windows.length).toBeGreaterThan(0);
  });
});
