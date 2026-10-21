import { describe, expect, it, vi } from 'vitest';
import { invalidateChannelTitlesOnSeoPatch } from './hooks';

describe('SEO channel-title query invalidation', () => {
  it('refreshes chosen-title comparisons when the selected title changes', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateChannelTitlesOnSeoPatch({ invalidateQueries }, { chosenTitleId: 'title-2' });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['channel-titles'] });
  });

  it('leaves channel-title queries alone for unrelated SEO edits', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateChannelTitlesOnSeoPatch({ invalidateQueries }, { descriptionIntro: 'New intro' });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
