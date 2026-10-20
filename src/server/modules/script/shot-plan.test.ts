import { describe, expect, it } from 'vitest';
import * as ShotPlan from './shot-plan';
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

  it.each([
    'được', 'đem', 'tôi', 'tới', 'trang', 'trắng', 'phóng', 'hàm', 'hộp', 'hợp',
    'lúa', 'lừa', 'chạy', 'chảy', 'mua', 'múa', 'mùa', 'máy', 'mày',
  ])('does not treat ordinary Vietnamese word "%s" as a cue', (word) => {
    const plan = planSceneShots([{ narration: 'Quiet.' }, { narration: word }]);
    expect(plan[1]).toEqual({ shotType: 'medium', lightType: 'overcast' });
  });

  it.each([
    ['đêm', 'night'], ['tối', 'night'], ['trăng', 'night'],
    ['lửa', 'firelight'], ['cháy', 'firelight'], ['đuốc', 'firelight'], ['pháo', 'firelight'], ['nổ', 'firelight'],
    ['trong nhà', 'interior'], ['phòng', 'interior'], ['hầm', 'interior'], ['lều', 'interior'], ['họp', 'interior'],
    ['bình minh', 'golden-hour'], ['hoàng hôn', 'golden-hour'], ['sáng sớm', 'golden-hour'], ['chiều tà', 'golden-hour'],
    ['mưa', 'overcast'], ['sương', 'overcast'], ['mây', 'overcast'], ['âm u', 'overcast'],
  ] as const)('matches accented light cue "%s"', (cue, expected) => {
    expect(planSceneShots([{ narration: cue }])[0]!.lightType).toBe(expected);
  });

  const planWithCueAt = (index: number, narration: string) => planSceneShots(
    Array.from({ length: index + 1 }, (_, sceneIndex) => ({ narration: sceneIndex === index ? narration : 'A quiet moment.' })),
  )[index]!;

  it.each([
    ['lá thư', 'detail', 1], ['tài liệu', 'detail', 1], ['vũ khí', 'detail', 1],
    ['hàng nghìn', 'high-angle', 1], ['toàn quân', 'high-angle', 1], ['đoàn', 'high-angle', 1],
    ['quyết định', 'medium', 5], ['nét mặt', 'medium', 5], ['áp đảo', 'low-angle', 2],
  ] as const)('matches accented shot cue "%s"', (cue, expected, index) => {
    expect(planWithCueAt(index, cue).shotType).toBe(expected);
  });

  it.each([
    ['lá thưx', 1, 'shot'], ['trong nhàx', 1, 'light'], ['bình minhx', 1, 'light'],
  ] as const)('requires a whole multi-word cue phrase for "%s"', (nearMiss, index, kind) => {
    const result = planWithCueAt(index, nearMiss);
    if (kind === 'shot') expect(result.shotType).toBe('medium');
    else expect(result.lightType).toBe('overcast');
  });

  it('normalizes decomposed Vietnamese narration before matching', () => {
    expect(planSceneShots([{ narration: 'đêm'.normalize('NFD') }])[0]!.lightType).toBe('night');
  });

  it.each(['Tôi nghe dem xuong.', 'Đ dem xuong.'])('uses the accented path for Vietnamese diacritic text "%s"', (narration) => {
    expect(planSceneShots([{ narration }])[0]!.lightType).toBe('daylight');
  });

  it.each([
    ['duoc', 'overcast'], ['dem', 'overcast'], ['toi', 'overcast'], ['trang', 'overcast'],
    ['phong', 'overcast'], ['ham', 'overcast'], ['hop', 'overcast'], ['lua', 'overcast'],
    ['chay', 'overcast'], ['mua', 'overcast'], ['may', 'overcast'],
  ] as const)('does not use ambiguous accent-less cue "%s" alone', (cue, expected) => {
    expect(planSceneShots([{ narration: 'Quiet.' }, { narration: cue }])[1]!.lightType).toBe(expected);
  });

  it.each([
    ['dem toi, anh trang', 'night'], ['dem xuong', 'night'], ['trong nha', 'interior'],
    ['cuoc hop', 'interior'], ['lua chay', 'firelight'], ['tieng no vang len', 'firelight'],
    ['mua roi', 'overcast'], ['binh minh', 'golden-hour'],
  ] as const)('retains unambiguous accent-less phrase cue "%s"', (narration, expected) => {
    expect(planSceneShots([{ narration }])[0]!.lightType).toBe(expected);
  });

  it('keeps English cues case-insensitive', () => {
    const plan = planSceneShots([{ narration: 'Quiet.' }, { narration: 'THE DOCUMENTS ARE STORED IN THE ROOM.' }]);
    expect(plan[1]).toEqual({ shotType: 'detail', lightType: 'interior' });
  });

  it('lets only a real night cue classify the realistic Vietnamese passage as night', () => {
    const scenes = [
      'Tôi được giao mua một cuộn vải cho nhà bếp.',
      'Trang sách mở ra khi chiếc thuyền cập bến.',
      'Người phụ nữ chạy về phía chợ rồi quay lại.',
      'Cửa hàng vừa mua thêm gạo vào buổi sáng.',
      'Tôi kể rằng mình được chọn để ghi chép câu chuyện.',
      'Đêm xuống khi đoàn người dừng chân nghỉ ngơi.',
      'Máy kéo chạy chậm qua cánh đồng sau cơn mưa.',
      'Trang phục của người thợ được sửa lại trước bữa trưa.',
      'Tôi mua thêm vài trang giấy để ghi chú.',
      'Người giao hàng chạy nhanh trên con đường làng.',
    ];
    const nightScenes = planSceneShots(scenes.map((narration) => ({ narration })))
      .flatMap((scene, index) => scene.lightType === 'night' ? [index] : []);
    expect(nightScenes).toEqual([5]);
  });

  it('keeps every Vietnamese cue literal NFC-normalized', () => {
    const cueTable = (ShotPlan as unknown as {
      SHOT_LIGHT_CUE_TABLE?: readonly { vietnameseCues: readonly string[] }[];
    }).SHOT_LIGHT_CUE_TABLE;
    expect(cueTable).toBeDefined();
    expect(cueTable?.flatMap(({ vietnameseCues }) => vietnameseCues)
      .every((cue) => cue === cue.normalize('NFC'))).toBe(true);
  });
});
