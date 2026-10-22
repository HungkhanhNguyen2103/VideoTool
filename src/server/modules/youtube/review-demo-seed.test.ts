import { describe, expect, it } from 'vitest';
import { getRetentionDropSegments } from './analysis';
import { mapRetentionDropsToScenes } from './review-evidence';
import { makeYoutubeReviewDemoRetentionCurve, makeYoutubeReviewDemoScenes } from '../../../../scripts/youtube-review-demo-data';

describe('Task 118 YouTube review demo data', () => {
  it('maps a stored retention drop to a scene in the linked 10-minute project', () => {
    const scenes = makeYoutubeReviewDemoScenes();
    const curve = makeYoutubeReviewDemoRetentionCurve();
    const drops = getRetentionDropSegments(curve, 600).segments;
    const mapped = mapRetentionDropsToScenes(drops, scenes, 600);

    expect(scenes.reduce((total, scene) => total + scene.durationSec, 0)).toBe(600);
    expect(mapped.mappingQuality).toBe('exact');
    expect(mapped.drops.some((drop) => drop.dropPercent >= 30 && drop.sceneIndexes.includes(2) && drop.sceneNarrationExcerpt.includes('Cảnh 2:'))).toBe(true);
  });
});
