import { describe, expect, it } from 'vitest';
import { planSceneShots } from './shot-plan';

describe('planSceneShots', () => {
  it('handles empty and single inputs and returns one assignment per scene', () => {
    expect(planSceneShots([])).toEqual([]);
    expect(planSceneShots([{ narration: 'A letter at night.' }])).toEqual([{ shotType: 'wide', lightType: 'night' }]);
  });

  it('is deterministic and maintains shot and light rhythm over 60 scenes', () => {
    const scenes = Array.from({ length: 60 }, () => ({ narration: 'A quiet moment.' }));
    const plan = planSceneShots(scenes);
    expect(planSceneShots(scenes)).toEqual(plan);
    expect(plan).toHaveLength(60);
    expect(plan[0]!.shotType).toBe('wide');
    for (let i = 1; i < plan.length; i += 1) {
      expect(plan[i]!.shotType).not.toBe(plan[i - 1]!.shotType);
      if (i > 1) {
        expect(plan[i]!.shotType).not.toBe(plan[i - 2]!.shotType);
        expect([plan[i - 2]!.lightType, plan[i - 1]!.lightType, plan[i]!.lightType].every((light) => light === plan[i]!.lightType)).toBe(false);
      }
    }
  });

  it('prefers a wide or high-angle shot at later chapter starts', () => {
    const scenes = Array.from({ length: 7 }, () => ({ narration: 'Quiet.' }));
    const plan = planSceneShots(scenes, { chapterStarts: new Set([0, 2, 5]) });
    expect(plan[0]!.shotType).toBe('wide');
    expect(['wide', 'high-angle']).toContain(plan[2]!.shotType);
    expect(['wide', 'high-angle']).toContain(plan[5]!.shotType);
  });

  it.each([
    ['A document appears.', 'detail'], ['Lá thư được mở.', 'detail'], ['La thu duoc mo.', 'detail'],
    ['The weapons and maps remain.', 'detail'],
    ['A fleet enters.', 'high-angle'], ['Toàn quân tiến lên.', 'high-angle'], ['Toan quan tien len.', 'high-angle'],
    ['The armies advance.', 'high-angle'],
    ['One person is deciding.', 'medium'], ['Nét mặt thay đổi.', 'medium'], ['Net mat thay doi.', 'medium'],
    ['A looming threat grows.', 'low-angle'], ['Áp đảo đối thủ.', 'low-angle'], ['Ap dao doi thu.', 'low-angle'],
  ] as const)('uses shot cue %s', (narration, expected) => {
    expect(planSceneShots([{ narration: 'Neutral.' }, { narration }])[1]!.shotType).toBe(expected);
  });

  it.each([
    ['At night.', 'night'], ['Đêm xuống.', 'night'], ['Dem xuong.', 'night'],
    ['Torches burn.', 'firelight'], ['A torch burns.', 'firelight'], ['Lửa cháy.', 'firelight'], ['Lua chay.', 'firelight'], ['Tiếng nổ vang lên.', 'firelight'], ['Tieng no vang len.', 'firelight'],
    ['Inside a bunker.', 'interior'], ['Trong hầm.', 'interior'], ['Trong ham.', 'interior'],
    ['At sunrise.', 'golden-hour'], ['Bình minh.', 'golden-hour'], ['Binh minh.', 'golden-hour'],
    ['Through the fog.', 'overcast'], ['Mưa rơi.', 'overcast'], ['Mua roi.', 'overcast'],
  ] as const)('uses light cue %s', (narration, expected) => {
    expect(planSceneShots([{ narration }])[0]!.lightType).toBe(expected);
  });

  it('switches the third identical cue-driven light', () => {
    expect(planSceneShots(Array.from({ length: 3 }, () => ({ narration: 'Night falls.' }))).map((item) => item.lightType)).toEqual(['night', 'night', 'firelight']);
  });

  it('does not treat an English no as an explosion', () => {
    expect(planSceneShots([{ narration: 'No one knew the answer.' }])[0]!.lightType).toBe('daylight');
  });
});
