import { describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../../../contracts/project';
import { emptySeoPackage } from '../../../contracts/seo';
import { buildShortsPanelItems, copyShortsText } from './shorts-view';

function project(): ProjectDetail {
  return {
    seo: emptySeoPackage(),
    scenes: [
      { id: 'a', narration: 'First active narration.', durationSec: 15, active: true },
      { id: 'off', narration: 'Must be excluded.', durationSec: 60, active: false },
      { id: 'b', narration: 'Second active narration.', durationSec: 15, active: true },
    ],
    chapters: [{ id: 'chapter-1', no: 1, title: 'Opening', role: 'climax', scenesCount: 3 }],
    renderSettings: { aspect: '16:9', width: 1280, height: 720, fps: 30 },
  } as unknown as ProjectDetail;
}

describe('Shorts panel view helpers', () => {
  it('builds candidates from deterministic windows with active narration excerpts and canonical defaults', () => {
    const items = buildShortsPanelItems(project());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      window: { id: 'short-a', startSec: 0, endSec: 30, sceneIds: ['a', 'b'] },
      short: { id: 'short-a', startSec: 0, endSec: 30, hashtags: ['#Shorts'] },
      saved: false,
      narrationExcerpt: 'First active narration.\nSecond active narration.',
      previewCaption: '',
      unresolvedPlaceholder: false,
    });
  });

  it('keeps matching saved editable text and substitutes only for display', () => {
    const value = project();
    value.seo.longVideoUrl = 'https://example.org/full';
    value.seo.shorts = [{
      id: 'short-a', startSec: 0, endSec: 30, chapterNo: 1, hookLine: 'Hook', title: 'Saved title',
      caption: 'Watch {LONG_VIDEO_URL}', hashtags: ['#Shorts'], reason: 'Reason',
    }];
    expect(buildShortsPanelItems(value)[0]).toMatchObject({
      short: { title: 'Saved title', caption: 'Watch {LONG_VIDEO_URL}' },
      saved: true,
      previewCaption: 'Watch https://example.org/full',
      unresolvedPlaceholder: false,
    });
  });

  it('marks an unresolved placeholder and returns no candidates when no eligible window exists', () => {
    const value = project();
    value.seo.shorts = [{
      id: 'short-a', startSec: 0, endSec: 30, chapterNo: 1, hookLine: '', title: '',
      caption: '{LONG_VIDEO_URL}', hashtags: ['#Shorts'], reason: '',
    }];
    value.seo.longVideoUrl = '';
    expect(buildShortsPanelItems(value)[0]?.unresolvedPlaceholder).toBe(true);
    value.scenes = [{ id: 'a', narration: 'Short', durationSec: 10, active: true }] as unknown as ProjectDetail['scenes'];
    value.chapters = [{ id: 'chapter-1', no: 1, title: 'Opening', role: null, scenesCount: 1 }] as unknown as ProjectDetail['chapters'];
    expect(buildShortsPanelItems(value)).toEqual([]);
  });

  it('does not expose stale stored text as editable when current windows changed', () => {
    const value = project();
    value.seo.shorts = [{
      id: 'short-old', startSec: 0, endSec: 30, chapterNo: 1, hookLine: 'Old hook', title: 'Old title',
      caption: 'Old caption', hashtags: ['#Shorts'], reason: 'Old reason',
    }];
    expect(buildShortsPanelItems(value).every((item) => !item.saved)).toBe(true);
  });

  it('returns a text fallback when clipboard writing fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    await expect(copyShortsText('caption', writeText)).resolves.toEqual({ copied: false, fallbackText: 'caption' });
    expect(writeText).toHaveBeenCalledWith('caption');
  });
});
