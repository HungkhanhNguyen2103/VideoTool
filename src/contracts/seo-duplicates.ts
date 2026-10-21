export const SEO_TITLE_CONTAINMENT_MIN_CHARS = 12;

export function normalizeSeoTitleForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Return chosen titles that equal or substantially overlap the current chosen title. */
export function findDuplicateTitle(chosenTitle: string, otherTitles: readonly string[]): string[] {
  const chosen = normalizeSeoTitleForComparison(chosenTitle);
  if (!chosen) return [];
  return otherTitles.filter((title) => {
    const other = normalizeSeoTitleForComparison(title);
    if (!other) return false;
    if (chosen === other) return true;
    const shorterLength = Math.min([...chosen].length, [...other].length);
    return shorterLength >= SEO_TITLE_CONTAINMENT_MIN_CHARS && (chosen.includes(other) || other.includes(chosen));
  });
}
