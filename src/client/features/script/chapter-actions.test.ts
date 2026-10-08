import { describe, expect, it } from 'vitest';
import type { ChapterDoc, ChapterStatus } from '../../../contracts/script';
import type { QAIssue } from './api';
import {
  approveAllTargets,
  chapterMetaText,
  chaptersSummaryText,
  generationModeForChapters,
  chapterEstimatedDurationSec,
  chapterWordCount,
  historyVersionLabel,
  runRegenerationQueue,
  selectedRegenTargets,
  toggleApproveStatus,
  toggleFlagStatus,
  manualTextAfterImport,
  buildQaRegenInstruction,
  chapterWordBudgetNote,
  findChapterIdByNumber,
  groupQaIssuesByChapter,
  instructionForChapter,
  findQuoteTarget,
  explainQuoteMatch,
  applyReplacementToParagraphs,
  qaLevelForAction,
  qaIssueInstruction,
  defaultExpandedQaKeys,
  sortQaIssues,
  summarizeQaIssues,
  qaSeverityTone,
  findUndoSnapshotIndex,
  splitQaIssuesByChapter,
  summarizeQaIssuesByChapter,
  chaptersWithHighQaIssues,
  planBulkQaApply,
  qaIssueKey,
  bulkUndoIsSafe,
  bulkUndoRevisionMatches,
  regenerationOutcomeAfterStream,
  runBulkQaApplyQueue,
} from './chapter-actions';

function chapter(id: string, status: ChapterStatus, extra: Partial<ChapterDoc> = {}): ChapterDoc {
  return { id, no: 1, title: `Chương ${id}`, paragraphs: [], status, scenesCount: null, durationSec: null, ...extra };
}

describe('toggleFlagStatus', () => {
  it('flags a chapter that is not already flagged', () => {
    expect(toggleFlagStatus('pending')).toBe('needs-fix');
    expect(toggleFlagStatus('approved')).toBe('needs-fix');
  });
  it('clears the flag back to pending', () => {
    expect(toggleFlagStatus('needs-fix')).toBe('pending');
  });
});

describe('toggleApproveStatus', () => {
  it('approves a chapter that is not already approved', () => {
    expect(toggleApproveStatus('pending')).toBe('approved');
    expect(toggleApproveStatus('needs-fix')).toBe('approved');
  });
  it('un-approves back to pending', () => {
    expect(toggleApproveStatus('approved')).toBe('pending');
  });
});

describe('approveAllTargets', () => {
  it('targets every non-generating chapter regardless of selection', () => {
    const chapters = [chapter('c1', 'pending'), chapter('c2', 'needs-fix'), chapter('c3', 'generating'), chapter('c4', 'approved')];
    expect(approveAllTargets(chapters)).toEqual(['c1', 'c2', 'c4']);
  });
  it('returns nothing when every chapter is already generating', () => {
    expect(approveAllTargets([chapter('c1', 'generating')])).toEqual([]);
  });
});

describe('selectedRegenTargets', () => {
  it('targets only selected, non-generating chapters', () => {
    const chapters = [chapter('c1', 'pending'), chapter('c2', 'generating'), chapter('c3', 'approved')];
    expect(selectedRegenTargets(chapters, new Set(['c1', 'c2', 'c3']))).toEqual(['c1', 'c3']);
  });
  it('ignores chapters that are not selected', () => {
    const chapters = [chapter('c1', 'pending'), chapter('c2', 'pending')];
    expect(selectedRegenTargets(chapters, new Set(['c2']))).toEqual(['c2']);
  });
  it('returns no targets when none are selected', () => {
    const chapters = [chapter('c1', 'generating'), chapter('c2', 'pending'), chapter('c3', 'approved')];
    expect(selectedRegenTargets(chapters, new Set())).toEqual([]);
  });
  it('does not replace a generating-only selection with an unselected chapter', () => {
    const chapters = [chapter('c1', 'generating'), chapter('c2', 'pending')];
    expect(selectedRegenTargets(chapters, new Set(['c1']))).toEqual([]);
  });
});

describe('regeneration instruction targeting', () => {
  it('keeps a user instruction for every bulk target', () => {
    expect(instructionForChapter({ kind: 'user' }, 'make it clearer', 'c2')).toBe('make it clearer');
  });

  it('keeps a QA instruction only for its source chapter', () => {
    const origin = { kind: 'qa' as const, chapterId: 'c2' };
    expect(instructionForChapter(origin, 'fix this issue', 'c2')).toBe('fix this issue');
    expect(instructionForChapter(origin, 'fix this issue', 'c3')).toBe('');
  });
});

describe('chapter word budget note', () => {
  it('returns null when no target word budget exists', () => {
    expect(chapterWordBudgetNote(chapter('c1', 'pending'))).toBeNull();
  });

  it('shows the signed percentage and amber tone outside the 80-120% band', () => {
    expect(chapterWordBudgetNote(chapter('c1', 'pending', { targetWords: 520, paragraphs: [' '.repeat(0) + Array.from({ length: 330 }, (_, index) => `word${index}`).join(' ')] }))).toEqual({
      text: 'mục tiêu 520 từ · hiện 330 (−37%)',
      tone: 'amber',
    });
  });

  it('uses muted tone inside the target band and amber when over target', () => {
    expect(chapterWordBudgetNote(chapter('c1', 'pending', { targetWords: 100, paragraphs: [Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ')] }))).toEqual({
      text: 'mục tiêu 100 từ · hiện 100 (+0%)',
      tone: 'muted',
    });
    expect(chapterWordBudgetNote(chapter('c1', 'pending', { targetWords: 100, paragraphs: [Array.from({ length: 121 }, (_, index) => `word${index}`).join(' ')] }))).toMatchObject({ tone: 'amber' });
  });
});

describe('chapterMetaText', () => {
  it('omits scene/duration text while unavailable', () => {
    expect(chapterMetaText(chapter('c1', 'pending'))).toBeNull();
  });
  it('renders paragraph count and a word-based estimate during review', () => {
    expect(chapterMetaText(chapter('c1', 'pending', { paragraphs: ['one', 'two words'] }))).toBe('2 cảnh · 2s · 3 từ');
  });
});

describe('chaptersSummaryText', () => {
  it('falls back to a chapter count while any chapter lacks scene/duration data', () => {
    const chapters = [chapter('c1', 'pending', { paragraphs: ['one'] }), chapter('c2', 'pending')];
    expect(chaptersSummaryText(chapters)).toBe('2 chương');
  });
  it('sums paragraph counts and word-based durations from narration', () => {
    const chapters = [
      chapter('c1', 'approved', { paragraphs: ['one', 'two words'] }),
      chapter('c2', 'approved', { paragraphs: ['three four'] }),
    ];
    expect(chaptersSummaryText(chapters)).toBe('2 chương • 3 cảnh • 3s • 5 từ');
  });
  it('reports zero chapters without summing anything', () => {
    expect(chaptersSummaryText([])).toBe('0 chương');
  });
});

describe('word-based review duration helpers', () => {
  it('counts whitespace words and applies the one-second minimum', () => {
    expect(chapterWordCount(chapter('c1', 'pending'))).toBe(0);
    expect(chapterWordCount(chapter('c1', 'pending', { paragraphs: [' one\n two ', 'three'] }))).toBe(3);
    expect(chapterEstimatedDurationSec(chapter('c1', 'pending'))).toBeNull();
    expect(chapterEstimatedDurationSec(chapter('c1', 'pending', { paragraphs: ['one'] }))).toBe(1);
    expect(chapterEstimatedDurationSec(chapter('c1', 'pending', { paragraphs: ['one', 'two words'] }))).toBe(2);
    expect(chapterEstimatedDurationSec(chapter('c1', 'pending', { paragraphs: [Array.from({ length: 150 }, () => 'word').join(' ')] }))).toBe(60);
  });
});

describe('historyVersionLabel', () => {
  it('labels the most recent (newest-first) snapshot with the highest number', () => {
    expect(historyVersionLabel(0, 3)).toBe('Bản 3');
    expect(historyVersionLabel(1, 3)).toBe('Bản 2');
    expect(historyVersionLabel(2, 3)).toBe('Bản 1');
  });
});

describe('QA regeneration undo guard', () => {
  const firstStartedAt = new Date('2026-10-06T10:00:00.000Z');
  const before = [
    chapter('c1', 'pending', { no: 1, title: 'Một', paragraphs: ['Bản cũ'], reviewStatus: 'clean' }),
    chapter('c2', 'approved', { no: 2, title: 'Hai', paragraphs: ['Không đổi'], reviewStatus: 'clean' }),
  ];

  it('returns the newest-first history index for the pre-run snapshot when other chapters are unchanged', () => {
    const history = [{ takenAt: new Date('2026-10-06T10:00:01.000Z'), chapters: before }];
    const now = [
      { ...before[0]!, paragraphs: ['Bản mới'] },
      before[1]!,
    ];

    expect(findUndoSnapshotIndex(history, now, 'c1', firstStartedAt)).toBe(0);
  });

  it('ignores the expected upstream-changed review flag on the next chapter', () => {
    const history = [{ takenAt: new Date('2026-10-06T10:00:01.000Z'), chapters: before }];
    const now = [
      { ...before[0]!, paragraphs: ['Bản mới'] },
      { ...before[1]!, reviewStatus: 'upstream-changed' as const },
    ];

    expect(findUndoSnapshotIndex(history, now, 'c1', firstStartedAt)).toBe(0);
  });

  it('rejects undo when the next chapter was also approved or edited', () => {
    const history = [{ takenAt: new Date('2026-10-06T10:00:01.000Z'), chapters: before }];
    const now = [
      { ...before[0]!, paragraphs: ['Bản mới'] },
      { ...before[1]!, status: 'pending' as const, paragraphs: ['Đã sửa sau lần tái tạo'], reviewStatus: 'upstream-changed' as const },
    ];

    expect(findUndoSnapshotIndex(history, now, 'c1', firstStartedAt)).toBeNull();
  });

  it('rejects undo when another chapter changed after the snapshot', () => {
    const history = [{ takenAt: new Date('2026-10-06T10:00:01.000Z'), chapters: before }];
    const now = [
      { ...before[0]!, paragraphs: ['Bản mới'] },
      { ...before[1]!, paragraphs: ['Đã sửa giữa chừng'] },
    ];

    expect(findUndoSnapshotIndex(history, now, 'c1', firstStartedAt)).toBeNull();
  });

  it('rejects undo when no snapshot was taken after the first run started', () => {
    const history = [{ takenAt: new Date('2026-10-06T09:59:59.000Z'), chapters: before }];
    expect(findUndoSnapshotIndex(history, before, 'c1', firstStartedAt)).toBeNull();
  });

  it('uses the oldest qualifying snapshot across two runs in one dialog session', () => {
    const beforeSecondRun = [
      { ...before[0]!, paragraphs: ['Bản mới lần một'] },
      { ...before[1]!, paragraphs: ['Tạm sửa trong lần hai'] },
    ];
    const history = [
      { takenAt: new Date('2026-10-06T10:02:00.000Z'), chapters: beforeSecondRun },
      { takenAt: new Date('2026-10-06T10:00:01.000Z'), chapters: before },
    ];
    const now = [
      { ...before[0]!, paragraphs: ['Bản mới lần hai'] },
      before[1]!,
    ];

    expect(findUndoSnapshotIndex(history, now, 'c1', firstStartedAt)).toBe(1);
  });
});

describe('runRegenerationQueue', () => {
  it('stops before remaining chapters when a regeneration reports an abort', async () => {
    const started: string[] = [];

    await runRegenerationQueue(['chapter-1', 'chapter-2', 'chapter-3'], async (chapterId) => {
      started.push(chapterId);
      return chapterId === 'chapter-1';
    });

    expect(started).toEqual(['chapter-1']);
  });
});

describe('manual generation state helpers', () => {
  it('allows the selected mode only before chapters exist', () => {
    expect(generationModeForChapters(0, 'manual')).toBe('manual');
    expect(generationModeForChapters(0, 'automatic')).toBe('automatic');
    expect(generationModeForChapters(2, 'manual')).toBe('automatic');
  });

  it('preserves pasted text after failed import and clears it after success', () => {
    expect(manualTextAfterImport('pasted document', false)).toBe('pasted document');
    expect(manualTextAfterImport('pasted document', true)).toBe('');
  });
});

describe('final QA helpers', () => {
  it('maps QA severity to an available badge tone', () => {
    expect(qaSeverityTone('high')).toBe('amber');
    expect(qaSeverityTone('medium')).toBe('indigo');
    expect(qaSeverityTone('low')).toBe('muted');
  });

  it('groups QA issues in first-appearance chapter order while preserving issue order', () => {
    const issues: QAIssue[] = [
      { chapter: 2, type: 'WEAK_HOOK', severity: 'low', reason: 'two-a', suggestedAction: 'SHORTEN' },
      { chapter: 1, type: 'REPETITION', severity: 'high', reason: 'one-a', suggestedAction: 'REMOVE_DUPLICATION' },
      { chapter: 2, type: 'FLAT_PACING', severity: 'medium', reason: 'two-b', suggestedAction: 'REGENERATE' },
    ];
    const grouped = groupQaIssuesByChapter(issues);
    expect([...grouped.entries()]).toEqual([[2, [issues[0], issues[2]]], [1, [issues[1]]]]);
  });

  it('returns no QA groups for an empty issue list', () => {
    expect(groupQaIssuesByChapter([])).toEqual(new Map());
  });

  it('splits issues for existing chapters and keeps out-of-range issues unplaced', () => {
    const issues: QAIssue[] = [
      { chapter: 2, type: 'WEAK_HOOK', severity: 'high', reason: 'two', suggestedAction: 'REGENERATE' },
      { chapter: 7, type: 'FLAT_PACING', severity: 'low', reason: 'missing', suggestedAction: 'SHORTEN' },
      { chapter: 1, type: 'REPETITION', severity: 'medium', reason: 'one', suggestedAction: 'REMOVE_DUPLICATION' },
    ];

    const placement = splitQaIssuesByChapter(issues, [{ no: 1 }, { no: 2 }, { no: 3 }]);
    expect([...placement.byChapterNo.entries()]).toEqual([[2, [issues[0]]], [1, [issues[2]]]]);
    expect(placement.unplaced).toEqual([issues[1]]);
  });

  it('summarizes each chapter and chooses its highest severity', () => {
    const issues: QAIssue[] = [
      { chapter: 2, type: 'WEAK_HOOK', severity: 'low', reason: 'low', suggestedAction: 'SHORTEN' },
      { chapter: 2, type: 'FLAT_PACING', severity: 'medium', reason: 'medium', suggestedAction: 'REGENERATE' },
      { chapter: 2, type: 'REPETITION', severity: 'high', reason: 'high', suggestedAction: 'REMOVE_DUPLICATION' },
      { chapter: 1, type: 'WEAK_PAYOFF', severity: 'medium', reason: 'one', suggestedAction: 'REVIEW_FACT' },
    ];

    expect([...summarizeQaIssuesByChapter(issues).entries()]).toEqual([
      [2, { total: 3, high: 1, medium: 1, low: 1, highest: 'high' }],
      [1, { total: 1, high: 0, medium: 1, low: 0, highest: 'medium' }],
    ]);
  });

  it('returns only chapters with visible high issues for auto-open', () => {
    const issues: QAIssue[] = [
      { chapter: 1, type: 'WEAK_HOOK', severity: 'high', reason: 'high', suggestedAction: 'REGENERATE' },
      { chapter: 2, type: 'FLAT_PACING', severity: 'medium', reason: 'medium', suggestedAction: 'SHORTEN' },
      { chapter: 3, type: 'REPETITION', severity: 'high', reason: 'high too', suggestedAction: 'REMOVE_DUPLICATION' },
    ];

    expect(chaptersWithHighQaIssues(issues)).toEqual(new Set([1, 3]));
  });

  it('builds a one-line regeneration instruction from a QA issue and display labels', () => {
    const issue: QAIssue = { chapter: 2, type: 'REPETITION', severity: 'high', reason: 'Ý này lặp lại.', suggestedAction: 'REMOVE_DUPLICATION' };
    expect(buildQaRegenInstruction(issue, 'Trùng lặp', 'Loại bỏ trùng lặp')).toBe('Trùng lặp: Ý này lặp lại. (Đề xuất: Loại bỏ trùng lặp)');
  });

  it('finds a chapter id by chapter number rather than array position', () => {
    const chapters = [chapter('chapter-8', 'pending', { no: 8 }), chapter('chapter-2', 'approved', { no: 2 }), chapter('chapter-4', 'pending', { no: 4 })];
    expect(findChapterIdByNumber(chapters, 2)).toBe('chapter-2');
    expect(findChapterIdByNumber(chapters, 5)).toBeNull();
  });

  it('finds a quote once in the requested paragraph, then rejects ambiguous matches', () => {
    const source = chapter('c1', 'pending', { paragraphs: ['Mở đầu có câu cần sửa.', 'Đoạn khác không có trích dẫn.'] });
    expect(findQuoteTarget(source, { paragraph: 1, quote: 'câu cần sửa' })).toEqual({ paragraphIndex: 0, start: 10, end: 21 });
    expect(findQuoteTarget(chapter('c1', 'pending', { paragraphs: ['Đoạn khác.', 'Ở đây có câu cần sửa lần nữa.'] }), { paragraph: 2, quote: 'câu cần sửa' })).toEqual({ paragraphIndex: 1, start: 9, end: 20 });
    expect(findQuoteTarget(chapter('c1', 'pending', { paragraphs: ['Mở đầu có câu cần sửa.', 'Ở đây có câu cần sửa lần nữa.'] }), { quote: 'câu cần sửa' })).toBeNull();
    expect(findQuoteTarget(source, { paragraph: 1, quote: 'không xuất hiện' })).toBeNull();
  });

  it('matches NFC and NFD Vietnamese text without changing the unique-match rule', () => {
    const paragraph = 'Câu thủy triều cần sửa.'.normalize('NFD');
    const quote = 'thủy triều'.normalize('NFC');
    const source = chapter('c1', 'pending', { paragraphs: [paragraph] });

    expect(explainQuoteMatch(source, { quote })).toBe('unique');
    expect(findQuoteTarget(source, { quote })).not.toBeNull();
    const nfcSource = chapter('c1', 'pending', { paragraphs: ['Câu thủy triều cần sửa.'] });
    const nfdTarget = findQuoteTarget(nfcSource, { quote: quote.normalize('NFD') });
    expect(applyReplacementToParagraphs(nfcSource.paragraphs, nfdTarget!, 'mặt nước')).toEqual(['Câu mặt nước cần sửa.']);
    expect(explainQuoteMatch(chapter('c1', 'pending', { paragraphs: ['Câu thủy triều.', 'Lặp thủy triều.'] }), { quote })).toBe('multiple');
    expect(explainQuoteMatch(source, { quote: 'thuy'.normalize('NFD') })).toBe('none');
    expect(explainQuoteMatch(source, {})).toBe('no-quote');
  });

  it('folds curly quotes and non-breaking spaces only one-to-one', () => {
    const straight = chapter('c1', 'pending', { paragraphs: ['Ông nói "đi thôi" rồi.'] });
    const curly = chapter('c1', 'pending', { paragraphs: ['Ông nói “đi thôi” rồi.'] });
    const nbsp = chapter('c1', 'pending', { paragraphs: ['Ông nói\u00a0đi thôi rồi.'] });
    const narrowNbsp = chapter('c1', 'pending', { paragraphs: ['Ông nói\u202fđi thôi rồi.'] });

    expect(explainQuoteMatch(straight, { quote: 'nói “đi thôi"' })).toBe('unique');
    expect(explainQuoteMatch(curly, { quote: 'nói "đi thôi"' })).toBe('unique');
    expect(explainQuoteMatch(nbsp, { quote: 'nói đi thôi' })).toBe('unique');
    expect(explainQuoteMatch(narrowNbsp, { quote: 'nói đi thôi' })).toBe('unique');
  });

  it('normalizes only the edited paragraph and replacement to NFC', () => {
    const original = 'Câu cần sửa: thủy triều.'.normalize('NFD');
    const source = chapter('c1', 'pending', { paragraphs: [original, 'Giữ nguyên NFD: hòa bình.'.normalize('NFD')] });
    const target = findQuoteTarget(source, { quote: 'thủy triều' });
    expect(target).not.toBeNull();

    const updated = applyReplacementToParagraphs(source.paragraphs, target!, 'mặt nước'.normalize('NFD'));
    expect(updated[0]).toBe('Câu cần sửa: mặt nước.'.normalize('NFC'));
    expect(updated[0]).toBe(updated[0]!.normalize('NFC'));
    expect(updated[1]).toBe(source.paragraphs[1]);
    expect(applyReplacementToParagraphs(['thủy triều', 'Giữ nguyên'], { paragraphIndex: 0, start: 0, end: 'thủy triều'.length }, '')).toEqual(['Giữ nguyên']);
  });

  it('applies a local replacement, normalizes only edit-boundary spaces, and removes an empty paragraph', () => {
    const target = { paragraphIndex: 0, start: 3, end: 6 };
    expect(applyReplacementToParagraphs(['A  old  B', 'Keep'], target, 'new')).toEqual(['A new B', 'Keep']);
    expect(applyReplacementToParagraphs(['old', 'Keep'], { paragraphIndex: 0, start: 0, end: 3 }, '')).toEqual(['Keep']);
  });

  it('maps QA actions to review levels and prefers a concrete instruction', () => {
    expect(qaLevelForAction('REMOVE_DUPLICATION')).toBe('light');
    expect(qaLevelForAction('SHORTEN')).toBe('light');
    expect(qaLevelForAction('REVIEW_FACT')).toBe('light');
    expect(qaLevelForAction('REGENERATE')).toBe('medium');
    expect(qaLevelForAction('MOVE_REVEAL')).toBe('medium');
    const issue: QAIssue = { chapter: 1, type: 'WEAK_HOOK', severity: 'high', reason: 'Hook yếu.', suggestedAction: 'REGENERATE', fixInstruction: 'Viết lại câu mở đầu.' };
    expect(qaIssueInstruction(issue, 'Hook yếu', 'Tái tạo')).toBe('Viết lại câu mở đầu.');
    expect(qaIssueInstruction({ ...issue, fixInstruction: undefined }, 'Hook yếu', 'Tái tạo')).toBe('Hook yếu: Hook yếu. (Đề xuất: Tái tạo)');
  });

  it('sorts QA issues by severity, chapter, and paragraph and summarizes active counts', () => {
    const issues: QAIssue[] = [
      { chapter: 2, paragraph: 2, type: 'FLAT_PACING', severity: 'low', reason: 'L', suggestedAction: 'SHORTEN' },
      { chapter: 1, paragraph: 3, type: 'REPETITION', severity: 'medium', reason: 'M2', suggestedAction: 'REMOVE_DUPLICATION' },
      { chapter: 1, paragraph: 1, type: 'WEAK_HOOK', severity: 'high', reason: 'H', suggestedAction: 'REGENERATE' },
      { chapter: 1, type: 'CREDIBILITY_RISK', severity: 'medium', reason: 'M1', suggestedAction: 'REVIEW_FACT' },
    ];
    expect(sortQaIssues(issues).map((issue) => issue.reason)).toEqual(['H', 'M2', 'M1', 'L']);
    expect(summarizeQaIssues(issues)).toEqual({ high: 1, medium: 2, low: 1 });
  });

  it('expands only the first issue after QA sorting', () => {
    const issues: QAIssue[] = [
      { chapter: 1, paragraph: 2, type: 'FLAT_PACING', severity: 'medium', reason: 'M', suggestedAction: 'SHORTEN' },
      { chapter: 1, paragraph: 1, type: 'WEAK_HOOK', severity: 'high', reason: 'H', suggestedAction: 'REGENERATE' },
      { chapter: 1, paragraph: 3, type: 'POSSIBLE_FILLER', severity: 'low', reason: 'L', suggestedAction: 'SHORTEN' },
    ];

    expect(defaultExpandedQaKeys(issues)).toEqual(new Set(['1:WEAK_HOOK:H']));
  });

  it('returns no expanded QA keys for an empty list', () => {
    expect(defaultExpandedQaKeys([])).toEqual(new Set());
  });

  it('uses sortQaIssues ordering when choosing the default card', () => {
    const issues: QAIssue[] = [
      { chapter: 2, paragraph: 1, type: 'WEAK_HOOK', severity: 'medium', reason: 'later', suggestedAction: 'REGENERATE' },
      { chapter: 1, paragraph: 4, type: 'FLAT_PACING', severity: 'medium', reason: 'paragraph', suggestedAction: 'SHORTEN' },
      { chapter: 1, paragraph: 2, type: 'REPETITION', severity: 'high', reason: 'highest', suggestedAction: 'REMOVE_DUPLICATION' },
    ];

    expect(defaultExpandedQaKeys(issues)).toEqual(new Set(['1:REPETITION:highest']));
  });

  it('filters three severity options and excludes accepted or dismissed issues from executable counts', () => {
    const make = (severity: QAIssue['severity'], reason: string): QAIssue => ({
      chapter: 1, type: 'REPETITION', severity, reason, suggestedAction: 'SHORTEN', quote: reason, replacement: `${reason}!`,
    });
    const high = make('high', 'high');
    const medium = make('medium', 'medium');
    const low = make('low', 'low');
    const accepted = make('high', 'accepted');
    const dismissed = make('medium', 'dismissed');
    const plan = (option: 'high' | 'high-medium' | 'all') => planBulkQaApply({
      issues: [high, medium, low, accepted, dismissed],
      chapters: [chapter('c1', 'pending', { paragraphs: ['high medium low accepted dismissed'] })],
      option,
      issueStates: { [qaIssueKey(accepted)]: 'accepted', [qaIssueKey(dismissed)]: 'dismissed' },
      regenMode: 'automatic',
    });
    const actionableCount = (planned: ReturnType<typeof plan>) => planned.patches.reduce((sum, item) => sum + item.issues.length, 0)
      + planned.regenerations.reduce((sum, item) => sum + item.issues.length, 0);

    expect(actionableCount(plan('high'))).toBe(1);
    expect(actionableCount(plan('high-medium'))).toBe(2);
    expect(actionableCount(plan('all'))).toBe(3);
  });

  it('re-finds sequential replacements, sorts chapters first, and skips stale or ambiguous quotes', () => {
    const first: QAIssue = { chapter: 1, type: 'REPETITION', severity: 'high', reason: 'First', suggestedAction: 'SHORTEN', quote: 'First target', replacement: 'A much longer inserted phrase' };
    const second: QAIssue = { chapter: 1, type: 'FLAT_PACING', severity: 'medium', reason: 'Second', suggestedAction: 'SHORTEN', quote: 'Later target', replacement: 'Later fixed' };
    const shifted: QAIssue = { chapter: 1, type: 'POSSIBLE_FILLER', severity: 'low', reason: 'Shifted', suggestedAction: 'SHORTEN', quote: 'A much longer inserted phrase', replacement: 'Final phrase' };
    const stale: QAIssue = { chapter: 1, type: 'DEAD_CHAPTER', severity: 'low', reason: 'Stale', suggestedAction: 'SHORTEN', quote: 'not present', replacement: 'ignored' };
    const ambiguous: QAIssue = { chapter: 1, type: 'TONE_DRIFT', severity: 'low', reason: 'Ambiguous', suggestedAction: 'SHORTEN', quote: 'repeat', replacement: 'ignored' };
    const laterChapter: QAIssue = { chapter: 2, type: 'REPETITION', severity: 'high', reason: 'Later chapter', suggestedAction: 'SHORTEN', quote: 'Chapter two', replacement: 'Chapter 2' };
    const result = planBulkQaApply({
      issues: [second, shifted, stale, ambiguous, laterChapter, first],
      chapters: [
        chapter('c2', 'pending', { no: 2, paragraphs: ['Chapter two starts here.'] }),
        chapter('c1', 'pending', { no: 1, paragraphs: ['First target then Later target.', 'repeat this', 'and repeat that'] }),
      ],
      option: 'all', issueStates: {}, regenMode: 'automatic',
    });

    expect(result.patches.map((item) => item.chapterNo)).toEqual([1, 2]);
    expect(result.patches[0]!.paragraphs).toEqual(['Final phrase then Later fixed.', 'repeat this', 'and repeat that']);
    expect(result.patches[0]!.issues.map((item) => item.reason)).toEqual(['First', 'Second', 'Shifted']);
    expect(result.skipped.map((item) => [item.issue.reason, item.reason])).toEqual([
      ['Stale', 'quote-not-found'], ['Ambiguous', 'ambiguous-quote'],
    ]);
  });

  it('merges one regeneration per chapter, selects the strongest level, and skips fact review or manual AI work', () => {
    const patchIssue: QAIssue = { chapter: 1, type: 'REPETITION', severity: 'high', reason: 'Patch', suggestedAction: 'SHORTEN', quote: 'duplicated', replacement: 'single' };
    const light: QAIssue = { chapter: 1, type: 'POSSIBLE_FILLER', severity: 'high', reason: 'Light', suggestedAction: 'SHORTEN', fixInstruction: 'Remove filler.' };
    const medium: QAIssue = { chapter: 1, type: 'WEAK_HOOK', severity: 'medium', reason: 'Medium', suggestedAction: 'REGENERATE', fixInstruction: 'Strengthen the opening.' };
    const fact: QAIssue = { chapter: 1, type: 'CREDIBILITY_RISK', severity: 'high', reason: 'Fact', suggestedAction: 'REVIEW_FACT', quote: 'fact', replacement: 'unverified' };
    const inputs = { issues: [medium, fact, patchIssue, light], chapters: [chapter('c1', 'pending', { paragraphs: ['duplicated fact'] })], option: 'all' as const, issueStates: {} };
    const automatic = planBulkQaApply({ ...inputs, regenMode: 'automatic', instructionForIssue: (issue) => issue.fixInstruction ?? issue.reason });

    expect(automatic.patches[0]!.issues).toEqual([patchIssue]);
    expect(automatic.regenerations).toHaveLength(1);
    expect(automatic.regenerations[0]).toMatchObject({ level: 'medium', instruction: expect.stringContaining('Remove filler.\nStrengthen the opening.') });
    expect(automatic.regenerations[0]!.instruction).toContain('Giữ nguyên các câu đã chỉnh theo QA');
    expect(automatic.skipped.map((item) => [item.issue.reason, item.reason])).toEqual([['Fact', 'review-fact']]);

    const manual = planBulkQaApply({ ...inputs, regenMode: 'manual', instructionForIssue: (issue) => issue.fixInstruction ?? issue.reason });
    expect(manual.patches[0]!.issues).toEqual([patchIssue]);
    expect(manual.regenerations).toEqual([]);
    expect(manual.skipped.map((item) => [item.issue.reason, item.reason])).toEqual([
      ['Fact', 'review-fact'], ['Light', 'manual-regeneration'], ['Medium', 'manual-regeneration'],
    ]);
  });

  it('omits the patched-sentence preservation note when the combined instruction exceeds its 4,000-character budget', () => {
    const patchIssue: QAIssue = { chapter: 1, type: 'REPETITION', severity: 'high', reason: 'Patch', suggestedAction: 'SHORTEN', quote: 'duplicated', replacement: 'single' };
    const regenIssue: QAIssue = { chapter: 1, type: 'WEAK_HOOK', severity: 'high', reason: 'Hook', suggestedAction: 'REGENERATE', fixInstruction: 'Rewrite the hook.' };
    const result = planBulkQaApply({
      issues: [patchIssue, regenIssue],
      chapters: [chapter('c1', 'pending', { paragraphs: ['duplicated sentence'] })],
      option: 'all',
      issueStates: {},
      regenMode: 'automatic',
      instructionForIssue: (issue) => issue === regenIssue ? 'x'.repeat(4_000) : issue.reason,
    });

    expect(result.regenerations[0]!.instruction).toBe('x'.repeat(4_000));
    expect(result.regenerations[0]!.instruction).not.toContain('Giữ nguyên các câu đã chỉnh theo QA');
  });

  it('skips missing chapters and replacement issues without a quote instead of guessing', () => {
    const missingChapter: QAIssue = { chapter: 2, type: 'REPETITION', severity: 'high', reason: 'Missing chapter', suggestedAction: 'REGENERATE' };
    const missingQuote: QAIssue = { chapter: 1, type: 'REPETITION', severity: 'high', reason: 'Missing quote', suggestedAction: 'SHORTEN', replacement: 'new text' };
    const result = planBulkQaApply({ issues: [missingChapter, missingQuote], chapters: [chapter('c1', 'pending', { paragraphs: ['Current text'] })], option: 'high', issueStates: {}, regenMode: 'automatic' });
    expect(result.patches).toEqual([]);
    expect(result.regenerations).toEqual([]);
    expect(result.skipped.map((item) => [item.issue.reason, item.reason])).toEqual([
      ['Missing quote', 'quote-missing'], ['Missing chapter', 'missing-chapter'],
    ]);
  });

  it('executes chapters in ascending order with each patch before its single regeneration', async () => {
    const plan = planBulkQaApply({
      issues: [
        { chapter: 2, type: 'REPETITION', severity: 'low', reason: 'patch 2', suggestedAction: 'SHORTEN', quote: 'two old', replacement: 'two new' },
        { chapter: 1, type: 'WEAK_HOOK', severity: 'high', reason: 'regen 1', suggestedAction: 'REGENERATE' },
        { chapter: 2, type: 'WEAK_HOOK', severity: 'low', reason: 'regen 2', suggestedAction: 'REGENERATE' },
        { chapter: 1, type: 'REPETITION', severity: 'high', reason: 'patch 1', suggestedAction: 'SHORTEN', quote: 'one old', replacement: 'one new' },
      ],
      chapters: [
        chapter('c2', 'pending', { no: 2, paragraphs: ['two old'] }),
        chapter('c1', 'pending', { no: 1, paragraphs: ['one old'] }),
      ],
      option: 'all', issueStates: {}, regenMode: 'automatic',
    });
    const order: string[] = [];

    const result = await runBulkQaApplyQueue(plan, {
      applyPatch: async (patch) => { order.push(`patch:${patch.chapterNo}`); },
      regenerate: async (regeneration) => { order.push(`regen:${regeneration.chapterNo}`); return { status: 'success' }; },
      isCancelled: () => false,
    });

    expect(order).toEqual(['patch:1', 'regen:1', 'patch:2', 'regen:2']);
    expect(result).toMatchObject({ appliedPatches: 2, regeneratedChapters: 2, failures: [], cancelled: false, skipped: [] });
  });

  it('continues after an ordinary chapter failure but stops all later work after a hard-stop failure', async () => {
    const plan = planBulkQaApply({
      issues: [
        { chapter: 1, type: 'WEAK_HOOK', severity: 'high', reason: 'regen 1', suggestedAction: 'REGENERATE' },
        { chapter: 2, type: 'REPETITION', severity: 'low', reason: 'patch 2', suggestedAction: 'SHORTEN', quote: 'old two', replacement: 'new two' },
        { chapter: 2, type: 'WEAK_HOOK', severity: 'low', reason: 'regen 2', suggestedAction: 'REGENERATE' },
      ],
      chapters: [chapter('c1', 'pending', { no: 1, paragraphs: ['one'] }), chapter('c2', 'pending', { no: 2, paragraphs: ['old two'] })],
      option: 'all', issueStates: {}, regenMode: 'automatic',
    });
    const ordinaryOrder: string[] = [];
    const ordinary = await runBulkQaApplyQueue(plan, {
      applyPatch: async (patch) => { ordinaryOrder.push(`patch:${patch.chapterNo}`); },
      regenerate: async (regeneration) => {
        ordinaryOrder.push(`regen:${regeneration.chapterNo}`);
        return { status: 'failed', hardStop: false, message: 'chapter error' };
      },
      isCancelled: () => false,
    });
    expect(ordinaryOrder).toEqual(['regen:1', 'patch:2', 'regen:2']);
    expect(ordinary.failures.map((failure) => failure.chapterNo)).toEqual([1, 2]);

    const hardStopOrder: string[] = [];
    const hardStop = await runBulkQaApplyQueue(plan, {
      applyPatch: async (patch) => { hardStopOrder.push(`patch:${patch.chapterNo}`); },
      regenerate: async (regeneration) => {
        hardStopOrder.push(`regen:${regeneration.chapterNo}`);
        return { status: 'failed', hardStop: true, message: 'provider auth failed' };
      },
      isCancelled: () => false,
    });
    expect(hardStopOrder).toEqual(['regen:1']);
    expect(hardStop.skipped.map((item) => [item.issue.reason, item.reason])).toEqual([
      ['patch 2', 'provider-hard-stop'], ['regen 2', 'provider-hard-stop'],
    ]);
  });

  it('stops after the current regeneration is aborted and keeps already applied edits', async () => {
    const plan = planBulkQaApply({
      issues: [
        { chapter: 1, type: 'REPETITION', severity: 'high', reason: 'patch 1', suggestedAction: 'SHORTEN', quote: 'old one', replacement: 'new one' },
        { chapter: 1, type: 'WEAK_HOOK', severity: 'high', reason: 'regen 1', suggestedAction: 'REGENERATE' },
        { chapter: 2, type: 'REPETITION', severity: 'low', reason: 'patch 2', suggestedAction: 'SHORTEN', quote: 'old two', replacement: 'new two' },
        { chapter: 2, type: 'WEAK_HOOK', severity: 'low', reason: 'regen 2', suggestedAction: 'REGENERATE' },
      ],
      chapters: [chapter('c1', 'pending', { no: 1, paragraphs: ['old one'] }), chapter('c2', 'pending', { no: 2, paragraphs: ['old two'] })],
      option: 'all', issueStates: {}, regenMode: 'automatic',
    });
    const order: string[] = [];

    const result = await runBulkQaApplyQueue(plan, {
      applyPatch: async (patch) => { order.push(`patch:${patch.chapterNo}`); },
      regenerate: async (regeneration) => { order.push(`regen:${regeneration.chapterNo}`); return { status: 'aborted' }; },
      isCancelled: () => false,
    });

    expect(order).toEqual(['patch:1', 'regen:1']);
    expect(result).toMatchObject({ appliedPatches: 1, regeneratedChapters: 0, cancelled: true });
    expect(result.skipped.map((item) => [item.issue.reason, item.reason])).toEqual([
      ['regen 1', 'cancelled-before-run'], ['patch 2', 'cancelled-before-run'], ['regen 2', 'cancelled-before-run'],
    ]);
  });

  it('allows bulk undo only while every chapter still matches the post-run state', () => {
    const chapterOne = chapter('c1', 'pending', { paragraphs: ['Applied QA patch'], reviewStatus: 'clean' });
    const chapterTwo = chapter('c2', 'pending', { no: 2, paragraphs: ['Unaffected'] });
    const expectedAfter = [chapterOne, chapterTwo];

    expect(bulkUndoIsSafe(expectedAfter, [{ ...chapterOne }, { ...chapterTwo }])).toBe(true);
    expect(bulkUndoIsSafe(expectedAfter, [{ ...chapterOne, paragraphs: ['Newer manual edit'] }, { ...chapterTwo }])).toBe(false);
    expect(bulkUndoIsSafe(expectedAfter, [{ ...chapterOne }, { ...chapterTwo, reviewStatus: 'upstream-changed' }])).toBe(false);
    expect(bulkUndoIsSafe(expectedAfter, [chapterOne])).toBe(false);
  });

  it('accepts undo only at the exact batch revision and after a completed stream wins over a late cancel', () => {
    expect(bulkUndoRevisionMatches(14, 14, true)).toBe(true);
    expect(bulkUndoRevisionMatches(14, 15, true)).toBe(false);
    expect(bulkUndoRevisionMatches(14, 14, false)).toBe(false);
    expect(regenerationOutcomeAfterStream(true, true, false)).toBe('success');
    expect(regenerationOutcomeAfterStream(false, true, false)).toBe('aborted');
    expect(regenerationOutcomeAfterStream(true, false, true)).toBe('failed');
  });

  it('reports progress by chapter position rather than patch/regeneration operation count', async () => {
    const plan = planBulkQaApply({
      issues: [
        { chapter: 4, type: 'REPETITION', severity: 'high', reason: 'patch', suggestedAction: 'SHORTEN', quote: 'old', replacement: 'new' },
        { chapter: 4, type: 'WEAK_HOOK', severity: 'high', reason: 'regen', suggestedAction: 'REGENERATE' },
        { chapter: 8, type: 'WEAK_HOOK', severity: 'high', reason: 'last', suggestedAction: 'REGENERATE' },
      ],
      chapters: [chapter('c4', 'pending', { no: 4, paragraphs: ['old'] }), chapter('c8', 'pending', { no: 8 })],
      option: 'all', issueStates: {}, regenMode: 'automatic',
    });
    const progress: Array<[string, number, number]> = [];

    await runBulkQaApplyQueue(plan, {
      applyPatch: async () => undefined,
      regenerate: async () => ({ status: 'success' }),
      isCancelled: () => false,
      onProgress: (detail, completed, total) => progress.push([detail, completed, total]),
    });

    expect(progress.at(-1)).toEqual(['Chương 2/2 · Đã tái tạo', 2, 2]);
    expect(progress.some(([detail]) => detail === 'Chương 1/2 · Đang áp dụng sửa cục bộ')).toBe(true);
  });
});
