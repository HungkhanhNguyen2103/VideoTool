export function pickVideoSceneIndexes(input: {
  chapterSceneCounts: number[];
  currentTypes: Array<'image' | 'video'>;
  locked: boolean[];
  targetPercent: number;
}): Set<number> {
  const sceneCount = input.currentTypes.length;
  const result = new Set<number>();
  if (sceneCount === 0) return result;

  const target = Math.min(
    sceneCount,
    input.targetPercent === 0 ? 0 : Math.max(1, Math.round(sceneCount * input.targetPercent / 100)),
  );
  const lockedVideoIndexes = input.currentTypes.flatMap((type, index) => (
    input.locked[index] && type === 'video' ? [index] : []
  ));
  lockedVideoIndexes.forEach((index) => result.add(index));

  const need = Math.min(
    Math.max(0, target - lockedVideoIndexes.length),
    input.locked.filter((locked) => !locked).length,
  );
  if (need === 0) return result;

  const counts = input.chapterSceneCounts;
  const validLayout = counts.length > 0
    && counts.every((count) => Number.isInteger(count) && count >= 0)
    && counts.reduce((sum, count) => sum + count, 0) === sceneCount;
  const chapters = validLayout ? counts : [sceneCount];
  const openers: number[] = [];
  const unlocked = new Set(input.locked.map((locked, index) => locked ? -1 : index).filter((index) => index >= 0));
  let start = 0;
  for (const count of chapters) {
    const opener = Array.from({ length: count }, (_, offset) => start + offset).find((index) => unlocked.has(index));
    if (opener !== undefined) openers.push(opener);
    start += count;
  }

  if (need <= openers.length) {
    for (let j = 0; j < need; j += 1) result.add(openers[Math.floor(j * openers.length / need)]!);
    return result;
  }

  openers.forEach((index) => result.add(index));
  const openerIndexes = new Set(openers);
  const pool = [...unlocked].filter((index) => !openerIndexes.has(index));
  const rest = Math.min(need - openers.length, pool.length);
  for (let j = 0; j < rest; j += 1) {
    result.add(pool[Math.floor((j + 0.5) * pool.length / rest)]!);
  }
  return result;
}
