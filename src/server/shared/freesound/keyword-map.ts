export const KEYWORD_MAP: Record<string, string> = {
  'tiếng hô xung trận': 'war drums distant battle ambience',
  'tiếng hô': 'war drums distant battle ambience',
  'tiếng đại bác': 'cannon fire',
  'tiếng súng': 'gunshot',
  'tiếng gươm': 'sword clash',
  'va chạm vũ khí': 'sword clash',
  'tiếng chân ngựa': 'horse gallop',
  'tiếng trống': 'war drum',
  'tiếng mái chèo': 'wooden boat oar',
  'tiếng thuyền': 'wooden ship creak',
  'tiếng sóng': 'river waves',
  'lửa cháy': 'fire crackling',
  'tiếng gió': 'wind blowing',
  'tiếng mưa': 'rain falling',
  'côn trùng': 'night ambience crickets',
  'đêm': 'night ambience crickets',
  'tiếng tích tắc đồng hồ': 'clock ticking',
  'đồng hồ': 'clock ticking',
  'tích tắc': 'clock ticking',
  'tiếng lật trang sách': 'page turn flip',
  'lật sách': 'page turn',
  'tiếng chuông': 'bell chime',
  'tiếng gõ phím': 'typing keyboard',
  'tiếng bước chân': 'footsteps',
  'tiếng tiền rơi': 'coins drop',
  'đóng tài liệu': 'paper folder close',
  'tiếng kịch tính': 'dramatic sting hit',
};

const UNTRANSLATED_NON_ASCII = /[^\x00-\x7F]/u;
const MAX_SEARCH_QUERIES = 3;

function mappedPhrase(lower: string): string | undefined {
  return Object.entries(KEYWORD_MAP).find(([vietnamese]) => lower.includes(vietnamese))?.[1];
}

export function normalizeKeyword(term: string): string {
  if (!term) return '';
  const lower = term.toLowerCase().trim();
  const mapped = mappedPhrase(lower);
  if (mapped) return mapped;

  const cleaned = lower
    .replace(/^tiếng\s+/u, '')
    .replace(/\b(sfx|sound effect|sound|value)\b/giu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return UNTRANSLATED_NON_ASCII.test(cleaned) ? '' : cleaned;
}

export function extractSearchQueries(sfxPrompt: string): string[] {
  if (!sfxPrompt) return [];

  const primary: string[] = [];
  const fallbacks: string[] = [];
  for (const part of sfxPrompt.split(/[,;\n|]+/u)) {
    const cleaned = normalizeKeyword(part);
    if (!cleaned || cleaned.length < 2) continue;
    primary.push(cleaned);
    const words = cleaned.split(' ');
    if (words.length > 2) fallbacks.push(words.slice(0, 2).join(' '));
  }

  return [...new Set([...primary, ...fallbacks])].slice(0, MAX_SEARCH_QUERIES);
}
