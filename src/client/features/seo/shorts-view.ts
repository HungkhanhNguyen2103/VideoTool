import type { ProjectDetail } from '../../../contracts/project';
import { SeoShortSchema, type SeoShort } from '../../../contracts/seo';
import { pickShortsWindows, sameShortsWindowFields, type ShortsWindow } from '../../../contracts/seo-shorts';
import { substituteLongVideoUrl } from '../../../contracts/seo-format';
import { copyPublishSlot, type PublishSlotClipboardWriter, type PublishSlotCopyResult } from './publish-schedule';

export type ShortsPanelItem = {
  window: ShortsWindow;
  short: SeoShort;
  saved: boolean;
  narrationExcerpt: string;
  previewCaption: string;
  unresolvedPlaceholder: boolean;
};

export function buildShortsPanelItems(project: ProjectDetail): ShortsPanelItem[] {
  const { windows } = pickShortsWindows(project);
  const storedSetMatches = sameShortsWindowFields(project.seo.shorts, windows);
  const storedById = new Map(project.seo.shorts.map((short) => [short.id, short]));
  const scenesById = new Map(project.scenes.filter((scene) => scene.active !== false).map((scene) => [scene.id, scene]));
  return windows.map((window) => {
    const stored = storedById.get(window.id);
    const short = stored
      && stored.startSec === window.startSec
      && stored.endSec === window.endSec
      && stored.chapterNo === window.chapterNo
      ? stored
      : SeoShortSchema.parse({ id: window.id, startSec: window.startSec, endSec: window.endSec, chapterNo: window.chapterNo, hookLine: '', title: '', caption: '', hashtags: ['#Shorts'], reason: '' });
    const narrationExcerpt = window.sceneIds
      .map((id) => scenesById.get(id)?.narration ?? '')
      .filter(Boolean)
      .join('\n')
      .slice(0, 1200);
    const unresolvedPlaceholder = !project.seo.longVideoUrl && short.caption.includes('{LONG_VIDEO_URL}');
    return {
      window,
      short,
      saved: storedSetMatches && Boolean(stored
        && stored.startSec === window.startSec
        && stored.endSec === window.endSec
        && stored.chapterNo === window.chapterNo),
      narrationExcerpt,
      previewCaption: substituteLongVideoUrl(short.caption, project.seo.longVideoUrl),
      unresolvedPlaceholder,
    };
  });
}

export function copyShortsText(
  text: string,
  writeText: PublishSlotClipboardWriter = (value) => navigator.clipboard.writeText(value),
): Promise<PublishSlotCopyResult> {
  return copyPublishSlot(text, writeText);
}
