export const KEYWORD_MAP: Record<string, string> = {
  "tiếng tích tắc đồng hồ": "clock ticking",
  "đồng hồ": "clock ticking",
  "tích tắc": "clock ticking",
  "tiếng lật trang sách": "page turn flip",
  "lật sách": "page turn",
  "tiếng chuông": "bell chime",
  "tiếng gõ phím": "typing keyboard",
  "tiếng súng": "gunshot",
  "tiếng bước chân": "footsteps",
  "tiếng gió": "wind blowing",
  "tiếng mưa": "rain falling",
  "tiếng tiền rơi": "coins drop",
  "tiếng cười": "laughing",
  "tiếng thở dài": "sigh",
  "đóng tài liệu": "paper folder close",
  "tiếng kịch tính": "dramatic sting hit",
};

export function normalizeKeyword(term: string): string {
  if (!term) return "";
  const lower = term.toLowerCase().trim();

  for (const [vi, en] of Object.entries(KEYWORD_MAP)) {
    if (lower.includes(vi)) {
      return en;
    }
  }

  return lower
    .replace(/^tiếng\s+/i, "")
    .replace(/\b(sfx|sound effect|sound|value)\b/gi, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSearchQueries(sfxPrompt: string): string[] {
  if (!sfxPrompt) return [];

  const rawParts = sfxPrompt.split(/[,;\n|]+/);
  const queries: string[] = [];

  for (const part of rawParts) {
    const cleaned = normalizeKeyword(part);
    if (cleaned && cleaned.length >= 2) {
      queries.push(cleaned);

      const words = cleaned.split(" ");
      if (words.length > 2) {
        queries.push(words.slice(0, 2).join(" "));
      }
    }
  }

  return Array.from(new Set(queries));
}
