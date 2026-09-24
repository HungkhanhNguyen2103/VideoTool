import { countNarrationWords, estimateNarrationDurationSec } from '../../../contracts/script';
import type { ChapterDoc, ChapterStatus } from '../../../contracts/script';
import type { QAIssue } from './api';

type ReviewDecisionStatus = Exclude<ChapterStatus, 'generating'>;
export type ScriptGenerationMode = 'automatic' | 'manual';

export function qaSeverityTone(severity: QAIssue['severity']): 'green' | 'amber' | 'indigo' | 'muted' {
  return severity === 'high' ? 'amber' : severity === 'medium' ? 'indigo' : 'muted';
}

export function groupQaIssuesByChapter(issues: readonly QAIssue[]): Map<number, QAIssue[]> {
  const grouped = new Map<number, QAIssue[]>();
  for (const issue of issues) {
    const chapterIssues = grouped.get(issue.chapter);
    if (chapterIssues) chapterIssues.push(issue);
    else grouped.set(issue.chapter, [issue]);
  }
  return grouped;
}

export function buildQaRegenInstruction(issue: QAIssue, typeLabel: string, actionLabel: string): string {
  return `${typeLabel}: ${issue.reason} (Đề xuất: ${actionLabel})`;
}

export function findChapterIdByNumber(chapters: readonly ChapterDoc[], chapterNo: number): string | null {
  return chapters.find((chapter) => chapter.no === chapterNo)?.id ?? null;
}

export function generationModeForChapters(chapterCount: number, requested: ScriptGenerationMode): ScriptGenerationMode {
  return chapterCount > 0 ? 'automatic' : requested;
}

export function manualTextAfterImport(raw: string, succeeded: boolean): string {
  return succeeded ? '' : raw;
}

/** Pure state-transition and targeting logic for the review page, kept apart from
 * rendering so it can be unit-tested without React or fetch. */

export function toggleFlagStatus(status: ChapterStatus): ReviewDecisionStatus {
  return status === 'needs-fix' ? 'pending' : 'needs-fix';
}

export function toggleApproveStatus(status: ChapterStatus): ReviewDecisionStatus {
  return status === 'approved' ? 'pending' : 'approved';
}

/** "Duyệt tất cả" always targets every non-generating chapter, independent of selection. */
export function approveAllTargets(chapters: readonly ChapterDoc[]): string[] {
  return chapters.filter((chapter) => chapter.status !== 'generating').map((chapter) => chapter.id);
}

/** The shared regeneration panel targets selected, non-generating chapters. With an
 * empty selection, it falls back to the first eligible chapter. */
export function selectedRegenTargets(chapters: readonly ChapterDoc[], selected: ReadonlySet<string>): string[] {
  const selectedTargets = chapters.filter((chapter) => selected.has(chapter.id) && chapter.status !== 'generating').map((chapter) => chapter.id);
  if (selectedTargets.length) return selectedTargets;
  if (selected.size) return [];
  const fallback = chapters.find((chapter) => chapter.status !== 'generating');
  return fallback ? [fallback.id] : [];
}

export function chapterWordCount(chapter: Pick<ChapterDoc, 'paragraphs'>): number {
  return chapter.paragraphs.reduce((sum, paragraph) => sum + countNarrationWords(paragraph), 0);
}

export function chapterEstimatedDurationSec(chapter: Pick<ChapterDoc, 'paragraphs'>): number | null {
  if (chapter.paragraphs.length === 0) return null;
  return chapter.paragraphs.reduce((sum, paragraph) => sum + estimateNarrationDurationSec(paragraph), 0);
}

/** Review metadata estimates duration from current narration until finalization persists scene values. */
export function chapterMetaText(chapter: Pick<ChapterDoc, 'paragraphs'>): string | null {
  const durationSec = chapterEstimatedDurationSec(chapter);
  if (durationSec == null) return null;
  return `${chapter.paragraphs.length} cảnh · ${durationSec}s · ${chapterWordCount(chapter)} từ`;
}

export function chaptersSummaryText(chapters: readonly ChapterDoc[]): string {
  const total = chapters.length;
  const allKnown = total > 0 && chapters.every((chapter) => chapter.paragraphs.length > 0);
  if (!allKnown) return `${total} chương`;
  const totalScenes = chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0);
  const totalSeconds = chapters.reduce((sum, chapter) => sum + (chapterEstimatedDurationSec(chapter) ?? 0), 0);
  const totalWords = chapters.reduce((sum, chapter) => sum + chapterWordCount(chapter), 0);
  return `${total} chương • ${totalScenes} cảnh • ${totalSeconds}s • ${totalWords} từ`;
}

/** History snapshots are stored newest-first (see service.ts's `$position: 0` push). Label the
 * most recent snapshot with the highest number, matching the prototype's ever-increasing versionSeq. */
export function historyVersionLabel(index: number, total: number): string {
  return `Bản ${total - index}`;
}

/** Runs one regeneration at a time and stops the batch as soon as one is aborted. */
export async function runRegenerationQueue<T>(items: readonly T[], regenerate: (item: T) => Promise<boolean>): Promise<void> {
  for (const item of items) {
    if (await regenerate(item)) return;
  }
}
