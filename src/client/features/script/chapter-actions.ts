import { countNarrationWords, estimateNarrationDurationSec } from '../../../contracts/script';
import type { ChapterDoc, ChapterStatus } from '../../../contracts/script';
import type { QAIssue } from './api';

type ReviewDecisionStatus = Exclude<ChapterStatus, 'generating'>;
export type ScriptGenerationMode = 'automatic' | 'manual';
export type InstructionOrigin = { kind: 'user' } | { kind: 'qa'; chapterId: string };
export type ChapterWordBudgetNote = { text: string; tone: 'amber' | 'muted' };

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

export type QaQuoteTarget = { paragraphIndex: number; start: number; end: number };

function quoteMatches(text: string, quote: string): number[] {
  if (!quote) return [];
  const matches: number[] = [];
  let from = 0;
  while (from <= text.length - quote.length) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    matches.push(index);
    from = index + quote.length;
  }
  return matches;
}

export function findQuoteTarget(chapter: Pick<ChapterDoc, 'paragraphs'>, issue: Pick<QAIssue, 'paragraph' | 'quote'>): QaQuoteTarget | null {
  if (!issue.quote) return null;
  const allMatches = chapter.paragraphs.flatMap((paragraph, paragraphIndex) => quoteMatches(paragraph, issue.quote!).map((start) => ({ paragraphIndex, start })));
  if (allMatches.length !== 1) return null;
  if (issue.paragraph != null && issue.paragraph >= 1 && issue.paragraph <= chapter.paragraphs.length) {
    const paragraphIndex = issue.paragraph - 1;
    const matches = quoteMatches(chapter.paragraphs[paragraphIndex]!, issue.quote);
    if (matches.length === 1) return { paragraphIndex, start: matches[0]!, end: matches[0]! + issue.quote.length };
  }
  const match = allMatches[0]!;
  return { paragraphIndex: match.paragraphIndex, start: match.start, end: match.start + issue.quote.length };
}

export function applyReplacementToParagraphs(paragraphs: readonly string[], target: QaQuoteTarget, replacement: string): string[] {
  return paragraphs.reduce<string[]>((result, paragraph, paragraphIndex) => {
    if (paragraphIndex !== target.paragraphIndex) {
      result.push(paragraph);
      return result;
    }
    const before = paragraph.slice(0, target.start);
    const after = paragraph.slice(target.end);
    const raw = `${before}${replacement}${after}`;
    const boundaryStart = Math.max(0, before.length - 2);
    const boundaryEnd = Math.min(raw.length, before.length + replacement.length + 2);
    const boundary = raw.slice(boundaryStart, boundaryEnd).replace(/[ \t]{2,}/g, ' ');
    const normalized = raw.slice(0, boundaryStart) + boundary + raw.slice(boundaryEnd);
    if (normalized.trim()) result.push(normalized);
    return result;
  }, []);
}

export function qaLevelForAction(action: QAIssue['suggestedAction']): 'light' | 'medium' {
  return action === 'REGENERATE' || action === 'MOVE_REVEAL' ? 'medium' : 'light';
}

export function qaIssueInstruction(issue: QAIssue, typeLabel: string, actionLabel: string): string {
  return issue.fixInstruction?.trim() || buildQaRegenInstruction(issue, typeLabel, actionLabel);
}

const qaSeverityOrder = { high: 0, medium: 1, low: 2 } as const;

export function sortQaIssues(issues: readonly QAIssue[]): QAIssue[] {
  return [...issues].sort((left, right) => (
    qaSeverityOrder[left.severity] - qaSeverityOrder[right.severity]
    || left.chapter - right.chapter
    || (left.paragraph ?? Number.POSITIVE_INFINITY) - (right.paragraph ?? Number.POSITIVE_INFINITY)
    || left.type.localeCompare(right.type)
    || left.reason.localeCompare(right.reason)
  ));
}

export function summarizeQaIssues(issues: readonly QAIssue[]): { high: number; medium: number; low: number } {
  return issues.reduce((summary, issue) => {
    summary[issue.severity] += 1;
    return summary;
  }, { high: 0, medium: 0, low: 0 });
}

export function qaIssueKey(issue: QAIssue): string {
  return `${issue.chapter}:${issue.type}:${issue.quote ?? issue.reason}`;
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

/** The shared regeneration panel targets selected, non-generating chapters. */
export function selectedRegenTargets(chapters: readonly ChapterDoc[], selected: ReadonlySet<string>): string[] {
  return chapters.filter((chapter) => selected.has(chapter.id) && chapter.status !== 'generating').map((chapter) => chapter.id);
}

export function instructionForChapter(origin: InstructionOrigin, instruction: string, chapterId: string): string {
  if (origin.kind === 'qa' && origin.chapterId !== chapterId) return '';
  return instruction;
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

export function chapterWordBudgetNote(chapter: Pick<ChapterDoc, 'paragraphs' | 'targetWords'>): ChapterWordBudgetNote | null {
  if (chapter.targetWords == null) return null;
  const currentWords = chapterWordCount(chapter);
  const ratio = currentWords / chapter.targetWords;
  const difference = Math.round(Math.abs(ratio - 1) * 100);
  const sign = currentWords >= chapter.targetWords ? '+' : '−';
  return {
    text: `mục tiêu ${chapter.targetWords} từ · hiện ${currentWords} (${sign}${difference}%)`,
    tone: ratio < 0.8 || ratio > 1.2 ? 'amber' : 'muted',
  };
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
