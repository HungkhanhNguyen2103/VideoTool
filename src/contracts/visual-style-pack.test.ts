import { describe, expect, it } from 'vitest';
import { LIGHT_TYPES, SHOT_TYPES, VISUAL_STYLE_IDS, type LightType, type ShotType } from './project';
import { VISUAL_STYLE_PACK_SLOTS, VisualStylePacksSchema, deriveReferenceTags, isVisualStylePackSlot } from './visual-style-pack';

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

describe('deriveReferenceTags', () => {
  it('omits tags for an unplanned legacy scene and strategic maps', () => {
    expect(deriveReferenceTags('cinematic', { shotType: null, lightType: null })).toBeUndefined();
    expect(deriveReferenceTags('strategic-map', { shotType: 'wide', lightType: 'night' })).toBeUndefined();
  });

  it.each([
    ['wide', 'interior', ['core', 'interior', 'wide']],
    ['high-angle', 'night', ['core', 'night', 'wide']],
    ['detail', 'firelight', ['core', 'night', 'props']],
    ['detail', 'interior', ['core', 'interior', 'props']],
    ['medium', 'daylight', ['core']],
    ['close', 'overcast', ['core']],
    ['low-angle', 'golden-hour', ['core']],
    [null, 'night', ['core', 'night']],
    ['wide', null, ['core', 'wide']],
  ] as const)('derives fixed ordered tags for %s / %s', (shotType, lightType, expected) => {
    expect(deriveReferenceTags('cinematic', { shotType, lightType })).toEqual(expected);
  });

  it('filters tags against the selected style slots without duplicates', () => {
    for (const styleId of ['cinematic', 'anime', 'watercolor', 'photorealistic', 'flat-cartoon'] as const) {
      const tags = deriveReferenceTags(styleId, { shotType: 'detail', lightType: 'firelight' })!;
      expect(tags).toEqual(['core', 'night', 'props']);
      expect(new Set(tags).size).toBe(tags.length);
      expect(tags.every((tag) => isVisualStylePackSlot(styleId, tag))).toBe(true);
    }
  });

  it('covers every planned shot and light combination in fixed order', () => {
    const shotTag: Record<ShotType, string | null> = {
      wide: 'wide', medium: null, close: null, detail: 'props', 'high-angle': 'wide', 'low-angle': null,
    };
    const lightTag: Record<LightType, string | null> = {
      daylight: null, overcast: null, 'golden-hour': null, night: 'night', firelight: 'night', interior: 'interior',
    };
    for (const shotType of SHOT_TYPES) {
      for (const lightType of LIGHT_TYPES) {
        const expected = ['core', lightTag[lightType], shotTag[shotType]].filter((tag): tag is string => tag !== null);
        expect(deriveReferenceTags('cinematic', { shotType, lightType })).toEqual([...new Set(expected)]);
      }
    }
  });

  it('removes a derived tag when the selected style does not define that slot', () => {
    const packs = VISUAL_STYLE_PACK_SLOTS as unknown as Record<string, readonly (typeof VISUAL_STYLE_PACK_SLOTS.cinematic[number])[]>;
    const original = packs.cinematic!;
    packs.cinematic = original.filter((slot) => slot.id !== 'night');
    try {
      expect(deriveReferenceTags('cinematic', { shotType: 'detail', lightType: 'firelight' })).toEqual(['core', 'props']);
    } finally {
      packs.cinematic = original;
    }
  });
});
