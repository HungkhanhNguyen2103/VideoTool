import type { LightType, ShotType } from '../../../contracts/project';

export type SceneShotPlan = { shotType: ShotType; lightType: LightType };

const SHOT_ROTATION: readonly ShotType[] = ['wide', 'medium', 'close', 'medium', 'detail', 'low-angle', 'high-angle'];
const SHOT_CUES: readonly { pattern: RegExp; choices: readonly ShotType[] }[] = [
  { pattern: /\b(documents?|letters?|weapons?|tools?|maps?|coins?|la thu|tai lieu|vu khi)\b/, choices: ['detail'] },
  { pattern: /\b(crowds?|arm(?:y|ies)|fleets?|whole region|thousands|hang nghin|toan quan|doan)\b/, choices: ['wide', 'high-angle'] },
  { pattern: /\b(single person|one person|speaking|deciding|reacting|quyet dinh|net mat)\b/, choices: ['medium', 'close'] },
  { pattern: /\b(looming threat|threat|power|overwhelming|ap dao)\b/, choices: ['low-angle'] },
];
const LIGHT_CUES: readonly { pattern: RegExp; light: LightType; originalPattern?: RegExp }[] = [
  { pattern: /\b(fire|torch(?:es)?|explosions?|shelling|lua|chay|duoc|phao|no (?:vang|tung|lon|ra))\b/, originalPattern: /nổ/i, light: 'firelight' },
  { pattern: /\b(night|moon|darkness|dem|toi|trang)\b/, light: 'night' },
  { pattern: /\b(indoors?|rooms?|bunkers?|tents?|councils?|meetings?|trong nha|phong|ham|leu|hop)\b/, light: 'interior' },
  { pattern: /\b(dawn|dusk|sunrise|sunset|binh minh|hoang hon|sang som|chieu ta)\b/, light: 'golden-hour' },
  { pattern: /\b(rain|fog|mist|clouds?|mua|suong|may|am u)\b/, light: 'overcast' },
];
const LIGHT_ALTERNATIVE: Record<LightType, LightType> = {
  daylight: 'overcast', overcast: 'daylight', 'golden-hour': 'daylight', night: 'firelight', firelight: 'night', interior: 'daylight',
};

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export function planSceneShots(
  scenes: readonly { narration: string }[],
  options: { chapterStarts?: ReadonlySet<number> } = {},
): SceneShotPlan[] {
  const plan: SceneShotPlan[] = [];
  for (const [index, scene] of scenes.entries()) {
    const narration = normalize(scene.narration);
    const previous = plan[index - 1]?.shotType;
    const twoBack = plan[index - 2]?.shotType;
    const preferred: readonly ShotType[] = index === 0
      ? ['wide']
      : options.chapterStarts?.has(index)
        ? ['wide', 'high-angle']
        : SHOT_CUES.find(({ pattern }) => pattern.test(narration))?.choices ?? [SHOT_ROTATION[index % SHOT_ROTATION.length]!];
    const candidates: ShotType[] = [...preferred, ...SHOT_ROTATION, 'wide', 'high-angle', 'detail', 'close', 'low-angle', 'medium'];
    const shotType = index === 0 ? 'wide' : candidates.find((candidate) => candidate !== previous && candidate !== twoBack)
      ?? candidates.find((candidate) => candidate !== previous)!;

    const inferredLight = LIGHT_CUES.find(({ pattern, originalPattern }) => pattern.test(narration) || originalPattern?.test(scene.narration))?.light
      ?? (index % 2 === 0 ? 'daylight' : 'overcast');
    const lightType = index >= 2 && plan[index - 1]!.lightType === inferredLight && plan[index - 2]!.lightType === inferredLight
      ? LIGHT_ALTERNATIVE[inferredLight]
      : inferredLight;
    plan.push({ shotType, lightType });
  }
  return plan;
}
