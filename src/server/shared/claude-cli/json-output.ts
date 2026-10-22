export type LeadingTextNotice = (text: string) => void;

function findFirstJsonValue(raw: string): { value: unknown; start: number } | null {
  const start = raw.search(/[\[{]/u);
  if (start < 0) return null;
  const expectedClosers: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '{') expectedClosers.push('}');
    else if (character === '[') expectedClosers.push(']');
    else if (character === '}' || character === ']') {
      if (expectedClosers.pop() !== character) return null;
      if (expectedClosers.length === 0) {
        try { return { value: JSON.parse(raw.slice(start, index + 1)) as unknown, start }; } catch { return null; }
      }
    }
  }
  return null;
}

/** Parse a complete JSON response, or a fenced/leading-text response when a notice callback is supplied. */
export function parseJsonWithLeadingText(raw: string, onLeadingText?: LeadingTextNotice): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
  } catch {
    const first = findFirstJsonValue(trimmed);
    if (first && onLeadingText) {
      const leading = trimmed.slice(0, first.start).trim();
      if (leading) onLeadingText(leading);
      return first.value;
    }
    throw new SyntaxError('Invalid JSON output.');
  }
}
