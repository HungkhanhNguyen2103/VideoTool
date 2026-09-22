const KEYWORD_MAP: Record<string, string> = {
  'am thanh': 'sound',
  'anh sang': 'light',
  'bat lua': 'lighter',
  'bien': 'ocean',
  'buoc chan': 'footsteps',
  'chim': 'bird',
  'cho': 'dog',
  'chuong': 'bell',
  'cua': 'door',
  'dien thoai': 'phone',
  'dong ho': 'clock',
  'dong co': 'engine',
  'gio': 'wind',
  'khoc': 'crying',
  'lua': 'fire',
  'may bay': 'airplane',
  'meo': 'cat',
  'mua': 'rain',
  'nuoc': 'water',
  'rung': 'forest',
  'sam': 'thunder',
  'sung': 'gun',
  'tich tac': 'ticking',
  'tich tac dong ho': 'ticking clock',
  'tho': 'breathing',
  'vot tay': 'applause',
  'xe': 'car',
  'cuoi': 'laughter',
};

export function normalizeKeyword(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSearchQueries(prompt: string): string[] {
  let cleaned = normalizeKeyword(prompt)
    .replace(/\b(?:sfx|sound effect|sound|value)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^tieng\s+/, '');
  cleaned = cleaned.replace(/^tieng\s+/, '').trim();
  if (!cleaned) return [];

  let translated = cleaned;
  for (const [source, target] of Object.entries(KEYWORD_MAP).sort(([a], [b]) => b.length - a.length)) {
    translated = translated.replace(new RegExp(`(?:^|\\s)${source.replace(/ /g, '\\s+')}(?=\\s|$)`, 'g'), ` ${target}`);
  }
  translated = translated.replace(/\s+/g, ' ').trim();
  const candidates = [translated, cleaned];
  if (cleaned.split(' ').length > 2) candidates.push(cleaned.split(' ').slice(-2).join(' '));
  return [...new Set(candidates.filter(Boolean))];
}
