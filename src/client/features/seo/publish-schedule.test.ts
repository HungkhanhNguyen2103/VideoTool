import { describe, expect, it } from 'vitest';
import { copyPublishSlot } from './publish-schedule';

describe('publish schedule client helpers', () => {
  it('reports clipboard success after writing the requested zone-qualified slot', async () => {
    let copied = '';
    const result = await copyPublishSlot('Thứ Ba 20/10/2026 20:00 (Asia/Ho_Chi_Minh)', async (text) => { copied = text; });

    expect(copied).toBe('Thứ Ba 20/10/2026 20:00 (Asia/Ho_Chi_Minh)');
    expect(result).toEqual({ copied: true, fallbackText: null });
  });

  it('returns the slot text for manual copying when clipboard writing fails', async () => {
    const result = await copyPublishSlot('Thứ Ba 20/10/2026 20:00 (Asia/Ho_Chi_Minh)', async () => { throw new Error('denied'); });

    expect(result).toEqual({ copied: false, fallbackText: 'Thứ Ba 20/10/2026 20:00 (Asia/Ho_Chi_Minh)' });
  });
});
