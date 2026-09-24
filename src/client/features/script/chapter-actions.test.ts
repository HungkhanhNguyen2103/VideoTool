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
  findChapterIdByNumber,
  groupQaIssuesByChapter,
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
  it('falls back to the first non-generating chapter when none are selected', () => {
    const chapters = [chapter('c1', 'generating'), chapter('c2', 'pending'), chapter('c3', 'approved')];
    expect(selectedRegenTargets(chapters, new Set())).toEqual(['c2']);
  });
  it('does not replace a generating-only selection with an unselected chapter', () => {
    const chapters = [chapter('c1', 'generating'), chapter('c2', 'pending')];
    expect(selectedRegenTargets(chapters, new Set(['c1']))).toEqual([]);
  });
});

describe('chapterMetaText', () => {
  it('omits scene/duration text while unavailable', () => {
    expect(chapterMetaText(chapter('c1', 'pending'))).toBeNull();
  });
  it('renders paragraph count and a word-based estimate during review', () => {
    expect(chapterMetaText(chapter('c1', 'pending', { paragraphs: ['one', 'two words'] }))).toBe('2 cảnh · 2s');
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
    expect(chaptersSummaryText(chapters)).toBe('2 chương • 3 cảnh • 3s');
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
});
