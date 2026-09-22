/**
 * Normalize a title for accent-insensitive search: NFD-decompose, strip combining
 * diacritics, map đ/Đ -> d/D, lowercase. Used both to build the stored `titleSearch`
 * field and to normalize an incoming search query the same way.
 */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Escape a string so it can be embedded literally inside a MongoDB $regex pattern. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
