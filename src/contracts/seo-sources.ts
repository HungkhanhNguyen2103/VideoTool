export type SourceReference = { title: string; url: string };

const NUMBERED_LINE = /^\s*(?:\[\s*\d+\s*\]|\d+[.)])\s+(.*?)\s*$/u;
const HTTP_URL = /https?:\/\/\S+/iu;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Parse only numbered reference lines with a valid HTTP(S) URL; first URL occurrence wins. */
export function parseSourceReferences(referencesText: string): SourceReference[] {
  const sources: SourceReference[] = [];
  const seenUrls = new Set<string>();
  for (const line of referencesText.split(/\r?\n/u)) {
    const numbered = NUMBERED_LINE.exec(line);
    if (!numbered) continue;
    const content = numbered[1] ?? '';
    const match = HTTP_URL.exec(content);
    if (!match) continue;
    const url = match[0].replace(/[.,;)]+$/u, '');
    if (!isHttpUrl(url) || seenUrls.has(url)) continue;
    const title = content.slice(0, match.index).trim().replace(/\s*[:\-–]+\s*$/u, '').trim();
    seenUrls.add(url);
    sources.push({ title, url });
    if (sources.length >= 8) break;
  }
  return sources;
}
