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

export type QaBulkApplyOption = 'high' | 'high-medium' | 'all';
export type QaBulkSkipReason = 'review-fact' | 'missing-chapter' | 'quote-missing' | 'quote-not-found' | 'ambiguous-quote' | 'manual-regeneration' | 'replacement-unchanged' | 'cancelled-before-run' | 'provider-hard-stop' | 'chapter-failed';
export type QaBulkSkip = { issue: QAIssue; reason: QaBulkSkipReason; label: string };
export type QaBulkPatchPlan = { chapterNo: number; chapterId: string; issues: QAIssue[]; paragraphs: string[] };
export type QaBulkRegenerationPlan = { chapterNo: number; chapterId: string; issues: QAIssue[]; instruction: string; level: 'light' | 'medium' | 'rewrite' };
export type QaBulkApplyPlan = {
  option: QaBulkApplyOption;
  patches: QaBulkPatchPlan[];
  regenerations: QaBulkRegenerationPlan[];
  skipped: QaBulkSkip[];
  actionableCount: number;
};

const QA_BULK_INSTRUCTION_LIMIT = 4_000;
const QA_BULK_PRESERVE_PATCH_NOTE = 'Giữ nguyên các câu đã chỉnh theo QA nếu không trực tiếp bị yêu cầu sửa.';

const QA_BULK_SKIP_LABELS: Record<QaBulkSkipReason, string> = {
  'review-fact': 'Cần người kiểm tra dữ kiện',
  'missing-chapter': 'Chương không còn tồn tại',
  'quote-missing': 'Gợi ý sửa không có trích dẫn để đối chiếu',
  'quote-not-found': 'Không tìm thấy trích dẫn trong bản hiện tại',
  'ambiguous-quote': 'Trích dẫn xuất hiện nhiều lần, không thể xác định an toàn',
  'manual-regeneration': 'Cần tái tạo chương thủ công',
  'replacement-unchanged': 'Gợi ý không làm thay đổi câu hiện tại',
  'cancelled-before-run': 'Không thực hiện vì lượt chạy đã bị huỷ',
  'provider-hard-stop': 'Chưa chạy vì đã dừng do lỗi xác thực hoặc nhà cung cấp',
  'chapter-failed': 'Chưa tái tạo vì thao tác khác trong chương thất bại',
};

function severityIncluded(severity: QAIssue['severity'], option: QaBulkApplyOption): boolean {
  if (option === 'high') return severity === 'high';
  if (option === 'high-medium') return severity === 'high' || severity === 'medium';
  return true;
}

function sameParagraphs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((paragraph, index) => paragraph === right[index]);
}

export function planBulkQaApply(args: {
  issues: readonly QAIssue[];
  chapters: readonly ChapterDoc[];
  option: QaBulkApplyOption;
  issueStates: Readonly<Record<string, 'accepted' | 'dismissed'>>;
  regenMode: ScriptGenerationMode;
  instructionForIssue?: (issue: QAIssue) => string;
}): QaBulkApplyPlan {
  const activeIssues = args.issues.filter((issue) => (
    severityIncluded(issue.severity, args.option)
    && args.issueStates[qaIssueKey(issue)] !== 'accepted'
    && args.issueStates[qaIssueKey(issue)] !== 'dismissed'
  ));
  const grouped = new Map<number, QAIssue[]>();
  for (const issue of activeIssues) {
    const existing = grouped.get(issue.chapter);
    if (existing) existing.push(issue);
    else grouped.set(issue.chapter, [issue]);
  }

  const chapterByNo = new Map(args.chapters.map((chapter) => [chapter.no, chapter]));
  const patches: QaBulkPatchPlan[] = [];
  const regenerations: QaBulkRegenerationPlan[] = [];
  const skipped: QaBulkSkip[] = [];
  const skip = (issue: QAIssue, reason: QaBulkSkipReason) => skipped.push({ issue, reason, label: QA_BULK_SKIP_LABELS[reason] });

  for (const chapterNo of [...grouped.keys()].sort((left, right) => left - right)) {
    const chapter = chapterByNo.get(chapterNo);
    const chapterIssues = sortQaIssues(grouped.get(chapterNo)!);
    if (!chapter) {
      for (const issue of chapterIssues) skip(issue, 'missing-chapter');
      continue;
    }

    let paragraphs = [...chapter.paragraphs];
    const patchIssues: QAIssue[] = [];
    const regenerationIssues: QAIssue[] = [];
    for (const issue of chapterIssues) {
      if (issue.suggestedAction === 'REVIEW_FACT') {
        skip(issue, 'review-fact');
        continue;
      }
      if (issue.replacement !== undefined) {
        if (!issue.quote) {
          skip(issue, 'quote-missing');
          continue;
        }
        const target = findQuoteTarget({ paragraphs }, issue);
        if (!target) {
          skip(issue, explainQuoteMatch({ paragraphs }, issue) === 'multiple' ? 'ambiguous-quote' : 'quote-not-found');
          continue;
        }
        const replaced = applyReplacementToParagraphs(paragraphs, target, issue.replacement);
        if (sameParagraphs(paragraphs, replaced)) {
          skip(issue, 'replacement-unchanged');
          continue;
        }
        paragraphs = replaced;
        patchIssues.push(issue);
        continue;
      }
      if (args.regenMode === 'manual') {
        skip(issue, 'manual-regeneration');
        continue;
      }
      regenerationIssues.push(issue);
    }

    if (patchIssues.length > 0) patches.push({ chapterNo, chapterId: chapter.id, issues: patchIssues, paragraphs });
    if (regenerationIssues.length > 0) {
      const instructions = regenerationIssues.map((issue) => (
        args.instructionForIssue?.(issue) ?? qaIssueInstruction(issue, issue.type, issue.suggestedAction)
      )).map((instruction) => instruction.trim()).filter(Boolean);
      const levelPriority = { light: 0, medium: 1, rewrite: 2 } as const;
      const level = regenerationIssues
        .map((issue) => qaLevelForAction(issue.suggestedAction))
        .reduce<'light' | 'medium' | 'rewrite'>((strongest, candidate) => levelPriority[candidate] > levelPriority[strongest] ? candidate : strongest, 'light');
      const instruction = instructions.join('\n');
      const preserveNoteFits = patchIssues.length > 0
        && instruction.length + QA_BULK_PRESERVE_PATCH_NOTE.length + 2 <= QA_BULK_INSTRUCTION_LIMIT;
      regenerations.push({ chapterNo, chapterId: chapter.id, issues: regenerationIssues, instruction, level });
      if (preserveNoteFits) regenerations[regenerations.length - 1]!.instruction += `\n\n${QA_BULK_PRESERVE_PATCH_NOTE}`;
    }
  }

  return {
    option: args.option,
    patches,
    regenerations,
    skipped,
    actionableCount: patches.reduce((sum, item) => sum + item.issues.length, 0) + regenerations.reduce((sum, item) => sum + item.issues.length, 0),
  };
}

export type QaBulkExecutionResult = {
  appliedPatches: number;
  regeneratedChapters: number;
  skipped: QaBulkSkip[];
  failures: Array<{ chapterNo: number; issues: QAIssue[]; message: string }>;
  cancelled: boolean;
};

export type QaBulkRegenerationOutcome =
  | { status: 'success' }
  | { status: 'aborted' }
  | { status: 'failed'; message: string; hardStop: boolean };

/** Runs each chapter in order: its patch first, then at most one regeneration. */
export async function runBulkQaApplyQueue(
  plan: QaBulkApplyPlan,
  callbacks: {
    applyPatch: (patch: QaBulkPatchPlan) => Promise<void>;
    regenerate: (regeneration: QaBulkRegenerationPlan) => Promise<QaBulkRegenerationOutcome>;
    isCancelled: () => boolean;
    onProgress?: (detail: string, completed: number, total: number) => void;
    onApplied?: (issues: readonly QAIssue[]) => void;
  },
): Promise<QaBulkExecutionResult> {
  const result: QaBulkExecutionResult = { appliedPatches: 0, regeneratedChapters: 0, skipped: [...plan.skipped], failures: [], cancelled: false };
  const patchByChapter = new Map(plan.patches.map((item) => [item.chapterNo, item]));
  const regenerationByChapter = new Map(plan.regenerations.map((item) => [item.chapterNo, item]));
  const chapterNos = [...new Set([...patchByChapter.keys(), ...regenerationByChapter.keys()])].sort((left, right) => left - right);
  const total = chapterNos.length;
  const addSkips = (items: readonly { issues: QAIssue[] }[], reason: 'cancelled-before-run' | 'provider-hard-stop') => {
    for (const item of items) {
      for (const issue of item.issues) result.skipped.push({ issue, reason, label: QA_BULK_SKIP_LABELS[reason] });
    }
  };
  let completed = 0;
  let lastProcessedChapterNo = 0;
  let hardStop = false;
  let stopReason: 'cancelled-before-run' | 'provider-hard-stop' | null = null;

  for (const chapterNo of chapterNos) {
    if (callbacks.isCancelled()) {
      result.cancelled = true;
      stopReason = 'cancelled-before-run';
      break;
    }
    if (hardStop) {
      stopReason = 'provider-hard-stop';
      break;
    }
    lastProcessedChapterNo = chapterNo;
    const chapterLabel = `Chương ${completed + 1}/${total}`;
    const patch = patchByChapter.get(chapterNo);
    const regeneration = regenerationByChapter.get(chapterNo);
    let patchFailed = false;

    if (patch) {
      callbacks.onProgress?.(`${chapterLabel} · Đang áp dụng sửa cục bộ`, completed, total);
      try {
        await callbacks.applyPatch(patch);
        result.appliedPatches += patch.issues.length;
        callbacks.onApplied?.(patch.issues);
      } catch (error) {
        patchFailed = true;
        result.failures.push({ chapterNo, issues: patch.issues, message: error instanceof Error ? error.message : 'Không thể áp dụng sửa cục bộ.' });
      }
      callbacks.onProgress?.(`${chapterLabel} · ${patchFailed ? 'Sửa cục bộ thất bại' : 'Đã áp dụng sửa cục bộ'}`, completed, total);
      if (callbacks.isCancelled()) {
        result.cancelled = true;
        if (regeneration) addSkips([regeneration], 'cancelled-before-run');
        stopReason = 'cancelled-before-run';
        completed += 1;
        callbacks.onProgress?.(`${chapterLabel} · Đã huỷ`, completed, total);
        break;
      }
    }

    if (!regeneration) {
      completed += 1;
      callbacks.onProgress?.(`${chapterLabel} · ${patchFailed ? 'Hoàn tất với lỗi sửa cục bộ' : 'Hoàn tất'}`, completed, total);
      continue;
    }
    if (patchFailed) {
      for (const issue of regeneration.issues) result.skipped.push({ issue, reason: 'chapter-failed', label: QA_BULK_SKIP_LABELS['chapter-failed'] });
      completed += 1;
      callbacks.onProgress?.(`${chapterLabel} · Bỏ qua tái tạo do lỗi sửa cục bộ`, completed, total);
      continue;
    }

    callbacks.onProgress?.(`${chapterLabel} · Đang tái tạo`, completed, total);
    let outcome: QaBulkRegenerationOutcome;
    try {
      outcome = await callbacks.regenerate(regeneration);
    } catch (error) {
      outcome = { status: 'failed', hardStop: false, message: error instanceof Error ? error.message : 'Không thể tái tạo chương.' };
    }
    if (outcome.status === 'success') {
      result.regeneratedChapters += 1;
      callbacks.onApplied?.(regeneration.issues);
    } else if (outcome.status === 'aborted') {
      result.cancelled = true;
      addSkips([regeneration], 'cancelled-before-run');
      stopReason = 'cancelled-before-run';
    } else {
      result.failures.push({ chapterNo, issues: regeneration.issues, message: outcome.message });
      if (outcome.hardStop) hardStop = true;
    }
    completed += 1;
    callbacks.onProgress?.(`${chapterLabel} · ${outcome.status === 'success' ? 'Đã tái tạo' : outcome.status === 'aborted' ? 'Đã huỷ' : 'Tái tạo thất bại'}`, completed, total);
    if (stopReason) break;
  }

  if (stopReason) {
    addSkips(plan.patches.filter((item) => item.chapterNo > lastProcessedChapterNo), stopReason);
    addSkips(plan.regenerations.filter((item) => item.chapterNo > lastProcessedChapterNo), stopReason);
  }
  return result;
}

function bulkUndoComparableChapter(chapter: ChapterDoc): string {
  return JSON.stringify({
    id: chapter.id,
    no: chapter.no,
    title: chapter.title,
    paragraphs: chapter.paragraphs,
    status: chapter.status,
    scenesCount: chapter.scenesCount,
    durationSec: chapter.durationSec,
    role: chapter.role ?? null,
    beat: chapter.beat ?? '',
    targetWords: chapter.targetWords ?? null,
    endsOnTension: chapter.endsOnTension ?? false,
    chapterSummary: chapter.chapterSummary ?? null,
    avoidRepeating: chapter.avoidRepeating ?? [],
    persistentFacts: chapter.persistentFacts ?? [],
    reviewStatus: chapter.reviewStatus ?? 'clean',
  });
}

/** Restoring the legacy history snapshot replaces every chapter, so require the entire script to be unchanged since the bulk run completed. */
export function bulkUndoIsSafe(expectedAfter: readonly ChapterDoc[], current: readonly ChapterDoc[]): boolean {
  if (expectedAfter.length !== current.length) return false;
  const currentById = new Map(current.map((chapter) => [chapter.id, chapter]));
  return expectedAfter.every((chapter) => {
    const currentChapter = currentById.get(chapter.id);
    return currentChapter !== undefined && bulkUndoComparableChapter(chapter) === bulkUndoComparableChapter(currentChapter);
  });
}

export function bulkUndoRevisionMatches(expectedVersion: number, currentVersion: number, revisionTrackingCertain: boolean): boolean {
  return revisionTrackingCertain && currentVersion === expectedVersion;
}

export function regenerationOutcomeAfterStream(
  streamCompleted: boolean,
  signalAborted: boolean,
  failed: boolean,
): 'success' | 'aborted' | 'failed' {
  if (!streamCompleted && signalAborted) return 'aborted';
  return failed ? 'failed' : 'success';
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
    tone: ratio < 0.85 || ratio > 1.15 ? 'amber' : 'muted',
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
