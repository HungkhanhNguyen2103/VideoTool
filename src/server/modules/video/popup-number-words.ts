const DIGIT_WORDS: Record<string, number> = {
  khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5,
  sau: 6, bay: 7, tam: 8, chin: 9,
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[đĐ]/gu, 'd').toLocaleLowerCase('vi');
}

function numericToken(value: string): number | null {
  if (/^\d{1,3}(?:\.\d{3})+$/u.test(value)) return Number(value.replace(/\./gu, ''));
  if (/^\d+(?:,\d+|\.\d+)$/u.test(value)) return Number(value.replace(',', '.'));
  return /^\d+$/u.test(value) ? Number(value) : null;
}

function tokenize(text: string): string[] {
  return normalize(text).match(/\d+(?:[.,]\d+)*|[\p{L}]+/gu) ?? [];
}

/** Parse the small Vietnamese number vocabulary needed to trace AI popup digits. */
export function parseVietnameseNumberPhrase(text: string): number | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return numericToken(tokens[0]!) ?? DIGIT_WORDS[tokens[0]!] ?? null;

  let total = 0;
  let group = 0;
  let pending: number | null = null;
  let lastScale: number | null = null;
  let sawNumber = false;
  for (const token of tokens) {
    const numeric = numericToken(token);
    if (numeric !== null) {
      pending = numeric;
      sawNumber = true;
      continue;
    }
    const digit = DIGIT_WORDS[token];
    if (digit !== undefined) {
      pending = digit;
      sawNumber = true;
      continue;
    }
    if (token === 'linh' || token === 'le') continue;
    if (token === 'muoi' || token === 'chuc') {
      group += (pending ?? 1) * 10;
      pending = null;
      continue;
    }
    if (token === 'tram') {
      group += (pending ?? 1) * 100;
      pending = null;
      continue;
    }
    const scale = token === 'nghin' || token === 'ngan' ? 1_000 : token === 'trieu' ? 1_000_000 : token === 'ty' ? 1_000_000_000 : null;
    if (scale !== null) {
      total += (group + (pending ?? 0) || 1) * scale;
      group = 0;
      pending = null;
      lastScale = scale;
      continue;
    }
    if (token === 'ruoi') {
      if (lastScale !== null) total += lastScale / 2;
      else group += 0.5;
      pending = null;
      continue;
    }
    if (sawNumber) break;
    return null;
  }
  const value = total + group + (pending ?? 0);
  return sawNumber && Number.isFinite(value) ? value : null;
}

export function extractPopupNumbers(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(/\d+(?:\.\d{3})*(?:,\d+)?/gu)) {
    const normalized = match[0]!.replace(/\./gu, '').replace(',', '.');
    const value = Number(normalized);
    if (Number.isFinite(value)) values.push(value);
  }
  const words = tokenize(text);
  for (let start = 0; start < words.length; start += 1) {
    if (!/[a-z]/u.test(words[start]!)) continue;
    for (let end = Math.min(words.length, start + 6); end > start; end -= 1) {
      const value = parseVietnameseNumberPhrase(words.slice(start, end).join(' '));
      if (value !== null && (end - start > 1 || /^\d+$/u.test(words[start]!))) {
        values.push(value);
        break;
      }
    }
  }
  return [...new Set(values)];
}
