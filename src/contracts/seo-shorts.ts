import type { ProjectDetail } from './project';
import { framesToSeconds, secondsToFrames } from './frame-math';
import { activeScenes } from './scene-active';

export const SHORTS_MIN_SEC = 30;
export const SHORTS_MAX_SEC = 55;
export const SHORTS_MAX_COUNT = 3;

export type ShortsWindow = {
  id: string;
  startSec: number;
  endSec: number;
  chapterNo: number;
  sceneIds: string[];
  /** Zero-based indexes into the compacted active-scene timeline; end index is inclusive. */
  sceneStartIndex: number;
  sceneEndIndex: number;
};

export type ShortsWindowsResult = { windows: ShortsWindow[]; warnings: string[] };

type ShortsProject = Pick<ProjectDetail, 'chapters' | 'scenes' | 'renderSettings'>;
type TimelineScene = { id: string; startFrame: number; endFrame: number; chapterNo: number };
type Candidate = { window: ShortsWindow; startFrame: number; endFrame: number; tier: number; distance: number };

/**
 * Pick reproducible 30–55 second edit suggestions from active scene boundaries.
 * Ranking favors windows fully inside the climax span (or longest active chapter
 * when no active climax exists), then proximity to that span's center, then time.
 * Scene indexes refer to the compacted active-scene timeline and end inclusively.
 */
export function pickShortsWindows(project: ShortsProject): ShortsWindowsResult {
  const { scenes, chapters, renderSettings } = project;
  const fps = renderSettings.fps;
  const counts = chapters.map((chapter) => chapter.scenesCount);
  const sceneCountTotal = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  if (counts.some((count) => count == null || !Number.isInteger(count) || count < 0) || sceneCountTotal !== scenes.length) {
    return { windows: [], warnings: ['Số cảnh theo chương chưa khớp với danh sách cảnh; chưa thể gợi ý mốc cắt Shorts.'] };
  }

  const timeline: TimelineScene[] = [];
  const chapterSpans: Array<{ no: number; role: string | null; startFrame: number; endFrame: number }> = [];
  let sceneIndex = 0;
  let frameCursor = 0;
  for (const chapter of chapters) {
    const count = chapter.scenesCount!;
    const chapterScenes = activeScenes(scenes.slice(sceneIndex, sceneIndex + count));
    sceneIndex += count;
    const chapterStart = frameCursor;
    for (const scene of chapterScenes) {
      const durationFrames = secondsToFrames(scene.durationSec, fps);
      timeline.push({ id: scene.id, startFrame: frameCursor, endFrame: frameCursor + durationFrames, chapterNo: chapter.no });
      frameCursor += durationFrames;
    }
    if (frameCursor > chapterStart) chapterSpans.push({ no: chapter.no, role: chapter.role ?? null, startFrame: chapterStart, endFrame: frameCursor });
  }

  if (timeline.length === 0 || frameCursor === 0) return { windows: [], warnings: [] };

  const activeClimax = chapterSpans.filter((span) => span.role === 'climax');
  const target = activeClimax.length > 0
    ? { startFrame: activeClimax[0]!.startFrame, endFrame: activeClimax[activeClimax.length - 1]!.endFrame }
    : chapterSpans.reduce((best, span) => {
      const duration = span.endFrame - span.startFrame;
      const bestDuration = best.endFrame - best.startFrame;
      return duration > bestDuration ? span : best;
    });
  const targetCenter = (target.startFrame + target.endFrame) / 2;
  const minFrames = SHORTS_MIN_SEC * fps;
  const maxFrames = SHORTS_MAX_SEC * fps;
  const candidates: Candidate[] = [];

  for (let startIndex = 0; startIndex < timeline.length; startIndex += 1) {
    const first = timeline[startIndex]!;
    let endFrame = first.startFrame;
    let endIndex = startIndex - 1;
    for (let index = startIndex; index < timeline.length; index += 1) {
      const scene = timeline[index]!;
      const nextEnd = scene.endFrame;
      const duration = nextEnd - first.startFrame;
      if (duration > maxFrames) break;
      endFrame = nextEnd;
      endIndex = index;
    }
    const durationFrames = endFrame - first.startFrame;
    if (endIndex < startIndex || durationFrames < minFrames) continue;
    const last = timeline[endIndex]!;
    const tier = first.startFrame >= target.startFrame && last.endFrame <= target.endFrame ? 1 : 2;
    const center = (first.startFrame + last.endFrame) / 2;
    candidates.push({
      window: {
        id: `short-${first.id}`,
        startSec: framesToSeconds(first.startFrame, fps),
        endSec: framesToSeconds(last.endFrame, fps),
        chapterNo: first.chapterNo,
        sceneIds: timeline.slice(startIndex, endIndex + 1).map((scene) => scene.id),
        sceneStartIndex: startIndex,
        sceneEndIndex: endIndex,
      },
      startFrame: first.startFrame,
      endFrame: last.endFrame,
      tier,
      distance: Math.abs(center - targetCenter),
    });
  }

  candidates.sort((left, right) => left.tier - right.tier || left.distance - right.distance || left.startFrame - right.startFrame || left.window.sceneStartIndex - right.window.sceneStartIndex);
  const selected: Candidate[] = [];
  for (const candidate of candidates) {
    const overlaps = selected.some((chosen) => candidate.startFrame < chosen.endFrame && chosen.startFrame < candidate.endFrame);
    if (overlaps) continue;
    selected.push(candidate);
    if (selected.length === SHORTS_MAX_COUNT) break;
  }
  return { windows: selected.map(({ window }) => window), warnings: [] };
}

export function sameShortsWindowFields(
  shorts: readonly Pick<ShortsWindow, 'id' | 'startSec' | 'endSec' | 'chapterNo'>[],
  windows: readonly Pick<ShortsWindow, 'id' | 'startSec' | 'endSec' | 'chapterNo'>[],
): boolean {
  return shorts.length === windows.length && shorts.every((short, index) => {
    const window = windows[index];
    return window !== undefined
      && short.id === window.id
      && short.startSec === window.startSec
      && short.endSec === window.endSec
      && short.chapterNo === window.chapterNo;
  });
}
