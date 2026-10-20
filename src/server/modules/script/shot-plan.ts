import type { LightType, ShotType } from '../../../contracts/project';

export type SceneShotPlan = { shotType: ShotType; lightType: LightType };

const SHOT_ROTATION: readonly ShotType[] = ['wide', 'medium', 'close', 'medium', 'detail', 'low-angle', 'high-angle'];

type ShotCueRule = {
  id: string;
  target: 'shot';
  englishPatterns: readonly string[];
  vietnameseCues: readonly string[];
  choices: readonly ShotType[];
};

type LightCueRule = {
  id: string;
  target: 'light';
  englishPatterns: readonly string[];
  vietnameseCues: readonly string[];
  light: LightType;
};

type CueRule = ShotCueRule | LightCueRule;

// Vietnamese cues are matched with their accents. Accentless narration uses only the
// explicit fallback phrases below because stripping accents collapses the colliding
// standalone cues duoc, dem, toi, trang, phong, ham, hop, lua, chay, mua, and may
// onto ordinary words such as "được", "tôi", "trắng", and "chạy".
export const SHOT_LIGHT_CUE_TABLE: readonly CueRule[] = [
  { id: 'shot-detail', target: 'shot', englishPatterns: ['documents?', 'letters?', 'weapons?', 'tools?', 'maps?', 'coins?'], vietnameseCues: ['lá thư', 'tài liệu', 'vũ khí'], choices: ['detail'] },
  { id: 'shot-wide', target: 'shot', englishPatterns: ['crowds?', 'arm(?:y|ies)', 'fleets?', 'whole region', 'thousands'], vietnameseCues: ['hàng nghìn', 'toàn quân', 'đoàn'], choices: ['wide', 'high-angle'] },
  { id: 'shot-medium', target: 'shot', englishPatterns: ['single person', 'one person', 'speaking', 'deciding', 'reacting'], vietnameseCues: ['quyết định', 'nét mặt'], choices: ['medium', 'close'] },
  { id: 'shot-low-angle', target: 'shot', englishPatterns: ['looming threat', 'threat', 'power', 'overwhelming'], vietnameseCues: ['áp đảo'], choices: ['low-angle'] },
  { id: 'light-firelight', target: 'light', englishPatterns: ['fire', 'torch(?:es)?', 'explosions?', 'shelling'], vietnameseCues: ['lửa', 'cháy', 'đuốc', 'pháo', 'nổ'], light: 'firelight' },
  { id: 'light-night', target: 'light', englishPatterns: ['night', 'moon', 'darkness'], vietnameseCues: ['đêm', 'tối', 'trăng'], light: 'night' },
  { id: 'light-interior', target: 'light', englishPatterns: ['indoors?', 'rooms?', 'bunkers?', 'tents?', 'councils?', 'meetings?'], vietnameseCues: ['trong nhà', 'phòng', 'hầm', 'lều', 'họp'], light: 'interior' },
  { id: 'light-golden-hour', target: 'light', englishPatterns: ['dawn', 'dusk', 'sunrise', 'sunset'], vietnameseCues: ['bình minh', 'hoàng hôn', 'sáng sớm', 'chiều tà'], light: 'golden-hour' },
  { id: 'light-overcast', target: 'light', englishPatterns: ['rain', 'fog', 'mist', 'clouds?'], vietnameseCues: ['mưa', 'sương', 'mây', 'âm u'], light: 'overcast' },
];

type AccentlessFallbackCue = { ruleId: string; cue: string };

const ACCENTLESS_FALLBACK_CUES: readonly AccentlessFallbackCue[] = [
  { ruleId: 'shot-detail', cue: 'la thu' },
  { ruleId: 'shot-detail', cue: 'tai lieu' },
  { ruleId: 'shot-detail', cue: 'vu khi' },
  { ruleId: 'shot-wide', cue: 'hang nghin' },
  { ruleId: 'shot-wide', cue: 'toan quan' },
  { ruleId: 'shot-medium', cue: 'quyet dinh' },
  { ruleId: 'shot-medium', cue: 'net mat' },
  { ruleId: 'shot-low-angle', cue: 'ap dao' },
  { ruleId: 'light-firelight', cue: 'lua chay' },
  { ruleId: 'light-firelight', cue: 'no vang' },
  { ruleId: 'light-firelight', cue: 'no tung' },
  { ruleId: 'light-firelight', cue: 'no lon' },
  { ruleId: 'light-firelight', cue: 'no ra' },
  { ruleId: 'light-night', cue: 'ban dem' },
  { ruleId: 'light-night', cue: 'dem xuong' },
  { ruleId: 'light-night', cue: 'anh trang' },
  { ruleId: 'light-interior', cue: 'trong nha' },
  { ruleId: 'light-interior', cue: 'trong ham' },
  { ruleId: 'light-interior', cue: 'trong phong' },
  { ruleId: 'light-interior', cue: 'trong leu' },
  { ruleId: 'light-interior', cue: 'cuoc hop' },
  { ruleId: 'light-golden-hour', cue: 'binh minh' },
  { ruleId: 'light-golden-hour', cue: 'hoang hon' },
  { ruleId: 'light-golden-hour', cue: 'sang som' },
  { ruleId: 'light-golden-hour', cue: 'chieu ta' },
  { ruleId: 'light-overcast', cue: 'mua roi' },
  { ruleId: 'light-overcast', cue: 'suong mu' },
  { ruleId: 'light-overcast', cue: 'may mu' },
  { ruleId: 'light-overcast', cue: 'am u' },
];

const VIETNAMESE_DIACRITICS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/;

const LIGHT_ALTERNATIVE: Record<LightType, LightType> = {
  daylight: 'overcast', overcast: 'daylight', 'golden-hour': 'daylight', night: 'firelight', firelight: 'night', interior: 'daylight',
};

const patternCache = new Map<string, RegExp>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesWholeCue(text: string, cue: string, literal: boolean): boolean {
  const cacheKey = `${literal ? 'literal' : 'pattern'}:${cue}`;
  let pattern = patternCache.get(cacheKey);
  if (!pattern) {
    const source = (literal ? escapeRegExp(cue) : cue).replace(/\s+/g, '\\s+');
    pattern = new RegExp(`(?<![\\p{L}\\p{M}])(?:${source})(?![\\p{L}\\p{M}])`, 'iu');
    patternCache.set(cacheKey, pattern);
  }
  return pattern.test(text);
}

function matchesRule(rule: CueRule, narration: string, hasDiacritics: boolean): boolean {
  if (rule.englishPatterns.some((pattern) => matchesWholeCue(narration, pattern, false))) return true;
  if (hasDiacritics) return rule.vietnameseCues.some((cue) => matchesWholeCue(narration, cue, true));
  return ACCENTLESS_FALLBACK_CUES.some(({ ruleId, cue }) => ruleId === rule.id && matchesWholeCue(narration, cue, true));
}

export function planSceneShots(
  scenes: readonly { narration: string }[],
  options: { chapterStarts?: ReadonlySet<number> } = {},
): SceneShotPlan[] {
  const plan: SceneShotPlan[] = [];
  for (const [index, scene] of scenes.entries()) {
    const narration = scene.narration.normalize('NFC').toLowerCase();
    const hasDiacritics = VIETNAMESE_DIACRITICS.test(narration);
    const previous = plan[index - 1]?.shotType;
    const twoBack = plan[index - 2]?.shotType;
    const shotCue = SHOT_LIGHT_CUE_TABLE.find((rule): rule is ShotCueRule =>
      rule.target === 'shot' && matchesRule(rule, narration, hasDiacritics));
    const preferred: readonly ShotType[] = index === 0
      ? ['wide']
      : options.chapterStarts?.has(index)
        ? ['wide', 'high-angle']
        : shotCue?.choices ?? [SHOT_ROTATION[index % SHOT_ROTATION.length]!];
    const candidates: ShotType[] = [...preferred, ...SHOT_ROTATION, 'wide', 'high-angle', 'detail', 'close', 'low-angle', 'medium'];
    const shotType = index === 0 ? 'wide' : candidates.find((candidate) => candidate !== previous && candidate !== twoBack)
      ?? candidates.find((candidate) => candidate !== previous)!;

    const lightCue = SHOT_LIGHT_CUE_TABLE.find((rule): rule is LightCueRule =>
      rule.target === 'light' && matchesRule(rule, narration, hasDiacritics));
    const inferredLight = lightCue?.light ?? (index % 2 === 0 ? 'daylight' : 'overcast');
    const lightType = index >= 2 && plan[index - 1]!.lightType === inferredLight && plan[index - 2]!.lightType === inferredLight
      ? LIGHT_ALTERNATIVE[inferredLight]
      : inferredLight;
    plan.push({ shotType, lightType });
  }
  return plan;
}
