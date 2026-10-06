import { countNarrationWords, estimateNarrationDurationSec } from '../../../contracts/script';
import type { ChapterDoc, ChapterSnapshot, ChapterStatus } from '../../../contracts/script';
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

export type QaIssuePlacement = { byChapterNo: Map<number, QAIssue[]>; unplaced: QAIssue[] };

export function splitQaIssuesByChapter(
  issues: readonly QAIssue[],
  chapters: readonly Pick<ChapterDoc, 'no'>[],
): QaIssuePlacement {
  const chapterNumbers = new Set(chapters.map((chapter) => chapter.no));
  const byChapterNo = new Map<number, QAIssue[]>();
  const unplaced: QAIssue[] = [];
  for (const issue of issues) {
    if (!chapterNumbers.has(issue.chapter)) {
      unplaced.push(issue);
      continue;
    }
    const chapterIssues = byChapterNo.get(issue.chapter);
    if (chapterIssues) chapterIssues.push(issue);
    else byChapterNo.set(issue.chapter, [issue]);
  }
  return { byChapterNo, unplaced };
}

export type QaChapterIssueSummary = { total: number; high: number; medium: number; low: number; highest: QAIssue['severity'] };

export function summarizeQaIssuesByChapter(issues: readonly QAIssue[]): Map<number, QaChapterIssueSummary> {
  const summaries = new Map<number, QaChapterIssueSummary>();
  for (const issue of issues) {
    const current = summaries.get(issue.chapter) ?? { total: 0, high: 0, medium: 0, low: 0, highest: 'low' as const };
    current.total += 1;
    current[issue.severity] += 1;
    if (qaSeverityOrder[issue.severity] < qaSeverityOrder[current.highest]) current.highest = issue.severity;
    summaries.set(issue.chapter, current);
  }
  return summaries;
}

export function chaptersWithHighQaIssues(issues: readonly QAIssue[]): Set<number> {
  return new Set(issues.filter((issue) => issue.severity === 'high').map((issue) => issue.chapter));
}

export function buildQaRegenInstruction(issue: QAIssue, typeLabel: string, actionLabel: string): string {
  return `${typeLabel}: ${issue.reason} (Đề xuất: ${actionLabel})`;
}

export type QaQuoteTarget = { paragraphIndex: number; start: number; end: number };
export type QuoteMatchOutcome = 'unique' | 'none' | 'multiple' | 'no-quote';

const quoteFoldMap: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u00a0': ' ',
  '\u202f': ' ',
};

function normalizeNfc(value: string): string {
  return value.normalize('NFC');
}

function normalizeForQuoteMatch(value: string): string {
  return normalizeNfc(value).replace(/[\u2018\u2019\u201c\u201d\u00a0\u202f]/g, (character) => quoteFoldMap[character]!);
}

function quoteMatches(text: string, quote: string): number[] {
  const normalizedText = normalizeForQuoteMatch(text);
  const normalizedQuote = normalizeForQuoteMatch(quote);
  if (!normalizedQuote) return [];
  const matches: number[] = [];
  let from = 0;
  while (from <= normalizedText.length - normalizedQuote.length) {
    const index = normalizedText.indexOf(normalizedQuote, from);
    if (index < 0) break;
    matches.push(index);
    from = index + normalizedQuote.length;
  }
  return matches;
}

function quoteMatchLocations(chapter: Pick<ChapterDoc, 'paragraphs'>, quote: string): Array<{ paragraphIndex: number; start: number }> {
  return chapter.paragraphs.flatMap((paragraph, paragraphIndex) => quoteMatches(paragraph, quote).map((start) => ({ paragraphIndex, start })));
}

export function explainQuoteMatch(chapter: Pick<ChapterDoc, 'paragraphs'>, issue: Pick<QAIssue, 'quote'>): QuoteMatchOutcome {
  if (!issue.quote) return 'no-quote';
  const count = quoteMatchLocations(chapter, issue.quote).length;
  return count === 0 ? 'none' : count === 1 ? 'unique' : 'multiple';
}

export function findQuoteTarget(chapter: Pick<ChapterDoc, 'paragraphs'>, issue: Pick<QAIssue, 'paragraph' | 'quote'>): QaQuoteTarget | null {
  if (!issue.quote) return null;
  const allMatches = quoteMatchLocations(chapter, issue.quote);
  if (allMatches.length !== 1) return null;
  if (issue.paragraph != null && issue.paragraph >= 1 && issue.paragraph <= chapter.paragraphs.length) {
    const paragraphIndex = issue.paragraph - 1;
    const matches = quoteMatches(chapter.paragraphs[paragraphIndex]!, issue.quote);
    if (matches.length === 1) return { paragraphIndex, start: matches[0]!, end: matches[0]! + normalizeForQuoteMatch(issue.quote).length };
  }
  const match = allMatches[0]!;
  return { paragraphIndex: match.paragraphIndex, start: match.start, end: match.start + normalizeForQuoteMatch(issue.quote).length };
}

export function applyReplacementToParagraphs(paragraphs: readonly string[], target: QaQuoteTarget, replacement: string): string[] {
  return paragraphs.reduce<string[]>((result, paragraph, paragraphIndex) => {
    if (paragraphIndex !== target.paragraphIndex) {
      result.push(paragraph);
      return result;
    }
    const normalizedParagraph = normalizeNfc(paragraph);
    const normalizedReplacement = normalizeNfc(replacement);
    const before = normalizedParagraph.slice(0, target.start);
    const after = normalizedParagraph.slice(target.end);
    const raw = `${before}${normalizedReplacement}${after}`;
    const boundaryStart = Math.max(0, before.length - 2);
    const boundaryEnd = Math.min(raw.length, before.length + normalizedReplacement.length + 2);
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

export function defaultExpandedQaKeys(issues: readonly QAIssue[]): Set<string> {
  const firstIssue = sortQaIssues(issues)[0];
  return firstIssue ? new Set([qaIssueKey(firstIssue)]) : new Set();
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

function undoComparableChapter(chapter: Pick<ChapterDoc, 'id' | 'paragraphs' | 'title' | 'status'>): string {
  return JSON.stringify({
    id: chapter.id,
    paragraphs: chapter.paragraphs,
    title: chapter.title,
    status: chapter.status,
  });
}

function otherChaptersMatchSnapshot(snapshot: ChapterSnapshot, chaptersNow: readonly ChapterDoc[], targetChapterId: string): boolean {
  const snapshotChapters = new Map(snapshot.chapters.filter((chapter) => chapter.id !== targetChapterId).map((chapter) => [chapter.id, chapter]));
  const currentChapters = new Map(chaptersNow.filter((chapter) => chapter.id !== targetChapterId).map((chapter) => [chapter.id, chapter]));
  if (snapshotChapters.size !== currentChapters.size) return false;
  for (const [chapterId, chapter] of currentChapters) {
    const snapshotChapter = snapshotChapters.get(chapterId);
    if (!snapshotChapter || undoComparableChapter(snapshotChapter) !== undoComparableChapter(chapter)) return false;
  }
  return true;
}

/** History is newest-first; undo uses the oldest snapshot taken after the first run began. */
export function findUndoSnapshotIndex(
  history: readonly ChapterSnapshot[],
  chaptersNow: readonly ChapterDoc[],
  targetChapterId: string,
  firstStartedAt: Date,
): number | null {
  let oldestQualifyingIndex: number | null = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]!.takenAt.getTime() >= firstStartedAt.getTime()) {
      oldestQualifyingIndex = index;
      break;
    }
  }
  if (oldestQualifyingIndex == null) return null;
  return otherChaptersMatchSnapshot(history[oldestQualifyingIndex]!, chaptersNow, targetChapterId)
    ? oldestQualifyingIndex
    : null;
}

/** Runs one regeneration at a time and stops the batch as soon as one is aborted. */
export async function runRegenerationQueue<T>(items: readonly T[], regenerate: (item: T) => Promise<boolean>): Promise<void> {
  for (const item of items) {
    if (await regenerate(item)) return;
  }
}
