import { describe, expect, it } from 'vitest';
import type { ChapterDoc, ChapterStatus } from '../../../contracts/script';
import {
  approveAllTargets,
  chapterMetaText,
  chaptersSummaryText,
  historyVersionLabel,
  runRegenerationQueue,
  selectedRegenTargets,
  toggleApproveStatus,
  toggleFlagStatus,
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
    expect(chapterMetaText({ scenesCount: null, durationSec: null })).toBeNull();
    expect(chapterMetaText({ scenesCount: 4, durationSec: null })).toBeNull();
    expect(chapterMetaText({ scenesCount: null, durationSec: 20 })).toBeNull();
  });
  it('renders both figures once finalizeScript() has computed them', () => {
    expect(chapterMetaText({ scenesCount: 4, durationSec: 20 })).toBe('4 cảnh · 20s');
  });
});

describe('chaptersSummaryText', () => {
  it('falls back to a chapter count while any chapter lacks scene/duration data', () => {
    const chapters = [chapter('c1', 'pending', { scenesCount: 4, durationSec: 20 }), chapter('c2', 'pending')];
    expect(chaptersSummaryText(chapters)).toBe('2 chương');
  });
  it('sums scenes and duration once every chapter has been finalized', () => {
    const chapters = [
      chapter('c1', 'approved', { scenesCount: 4, durationSec: 20 }),
      chapter('c2', 'approved', { scenesCount: 3, durationSec: 15 }),
    ];
    expect(chaptersSummaryText(chapters)).toBe('2 chương • 7 cảnh • 35s');
  });
  it('reports zero chapters without summing anything', () => {
    expect(chaptersSummaryText([])).toBe('0 chương');
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
