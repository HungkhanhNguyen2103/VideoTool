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
  sortQaIssues,
  summarizeQaIssues,
  qaSeverityTone,
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
});
