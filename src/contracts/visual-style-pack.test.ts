import { describe, expect, it } from 'vitest';
import { VISUAL_STYLE_IDS } from './project';
import { VISUAL_STYLE_PACK_SLOTS, VisualStylePacksSchema, isVisualStylePackSlot } from './visual-style-pack';

describe('visual style packs', () => {
  it('defines five complete, unique prompts for every style', () => {
    for (const styleId of VISUAL_STYLE_IDS) {
      const slots = VISUAL_STYLE_PACK_SLOTS[styleId];
      expect(slots).toHaveLength(5);
      expect(slots[0]?.id).toBe('core');
      expect(new Set(slots.map((slot) => slot.id)).size).toBe(5);
      for (const slot of slots) {
        expect(slot.label.trim()).not.toBe('');
        expect(slot.hint.trim()).not.toBe('');
        expect(slot.prompt.trim()).not.toBe('');
        expect(slot.prompt).not.toMatch(/\{\{|\}\}|\[SUBJECT\]|<SUBJECT>/);
        expect(isVisualStylePackSlot(styleId, slot.id)).toBe(true);
      }
    }
    expect(isVisualStylePackSlot('strategic-map', 'props')).toBe(false);
  });

  it('parses sparse uploaded image entries', () => {
    const sample = { url: '/files/a.png', filename: 'a.png', source: 'shared', updatedAt: new Date().toISOString() };
    expect(VisualStylePacksSchema.parse({ cinematic: { core: sample } })).toEqual({ cinematic: { core: sample } });
  });
});
