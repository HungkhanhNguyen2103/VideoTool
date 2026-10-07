import { describe, expect, it } from 'vitest';
import { chooseBestSfxCandidate, type FreesoundSoundCandidate } from './sound-picker';

function sound(candidate: Partial<FreesoundSoundCandidate> & Pick<FreesoundSoundCandidate, 'id' | 'name' | 'tags'>): FreesoundSoundCandidate {
  return {
    id: candidate.id,
    name: candidate.name,
    tags: candidate.tags,
    duration: candidate.duration ?? 4,
    avg_rating: candidate.avg_rating ?? 4,
    num_ratings: candidate.num_ratings ?? 5,
    previews: candidate.previews ?? { 'preview-hq-mp3': `https://cdn.test/${candidate.id}.mp3` },
  };
}

describe('Freesound SFX candidate selection', () => {
  it('rejects a top-rated human shout and chooses the relevant battle drums', () => {
    const candidates = [
      sound({ id: 1, name: 'Loud war cry shout', tags: ['battle', 'shout'], avg_rating: 5, num_ratings: 90 }),
      sound({ id: 2, name: 'Distant battle drums', tags: ['war', 'drums', 'battle', 'ambience'], avg_rating: 4.2, num_ratings: 8 }),
    ];

    expect(chooseBestSfxCandidate(candidates, 'war drums distant battle ambience')?.id).toBe(2);
  });

  it('rejects clips shorter than one second and prefers query tag overlap', () => {
    const candidates = [
      sound({ id: 1, name: 'River ambience', tags: ['water'], duration: 0.8, avg_rating: 5 }),
      sound({ id: 2, name: 'River waves', tags: ['river', 'waves'], duration: 4, avg_rating: 3.8 }),
      sound({ id: 3, name: 'Wind ambience', tags: ['wind', 'ambience'], duration: 4, avg_rating: 4.9 }),
    ];

    expect(chooseBestSfxCandidate(candidates, 'river waves')?.id).toBe(2);
  });

  it('returns null when every candidate is voice-like or too short', () => {
    expect(chooseBestSfxCandidate([
      sound({ id: 1, name: 'Crowd chanting', tags: ['chant', 'crowd'] }),
      sound({ id: 2, name: 'Tiny impact', tags: ['impact'], duration: 0.5 }),
    ], 'battle ambience')).toBeNull();
  });
});
