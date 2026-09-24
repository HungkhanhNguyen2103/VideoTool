# Phase 5 Prompt 1 — fix required before acceptance: Freesound keyword dictionary does not match the reference

Found while reviewing commit `7278cf8` (`src/server/shared/freesound/keyword-map.ts`).

The spec and the original addendum said to port the Vietnamese→English keyword dictionary "verbatim" from the reference `sfxService.ts`. The actual reference content was never given to you as text (it was only shared with me as an uploaded file), so the dictionary you wrote is a different, invented mapping — not a port. This needs to be corrected now, since the acceptance report explicitly called this out as a "decision outside spec," which means the gap is known but unresolved.

Here is the actual reference content, copied verbatim. Replace your current `KEYWORD_MAP` and `normalizeKeyword`/`extractSearchQueries` logic with this exact behavior:

```ts
const VI_TO_EN_MAP: Record<string, string> = {
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

function normalizeKeyword(term: string): string {
  if (!term) return "";
  const lower = term.toLowerCase().trim();

  for (const [vi, en] of Object.entries(VI_TO_EN_MAP)) {
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

function extractSearchQueries(sfxPrompt: string): string[] {
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
```

Important behavioral differences from what you implemented — these are not stylistic, fix them exactly:

1. **Matching order**: `normalizeKeyword` checks the map FIRST, against the lowercased-but-NOT-accent-stripped input (`lower.includes(vi)` where `vi` still has Vietnamese diacritics — e.g. `"đồng hồ"`, not `"dong ho"`). Only if no dictionary entry matches does it fall through to the generic cleaning path (accent handling only happens in that fallback branch — actually re-check: the reference has NO accent-stripping at all in `normalizeKeyword`; the fallback just strips the `"tiếng "` prefix and filter words, then removes non-ASCII-letter characters via `[^a-zA-Z0-9\s]`, which incidentally drops accented characters without transliterating them). Do not accent-strip before the dictionary lookup — that would make every accented key in `VI_TO_EN_MAP` unreachable, since the keys themselves are accented strings.
2. **Multi-query fallback**: `extractSearchQueries` also pushes a truncated 2-word prefix of any cleaned phrase longer than 2 words, in addition to the full cleaned phrase — this is a real behavioral difference from a single-query-per-part approach.
3. **Dedup**: `Array.from(new Set(queries))` — preserves first-seen order, removes duplicates across all parts of the prompt, not just within one part.
4. **Splitting**: input is split on `[,;\n|]+` (comma, semicolon, newline, or pipe), not just comma.

Update `keyword-map.ts` (rename `VI_TO_EN_MAP` export appropriately, e.g. `KEYWORD_MAP`, but keep every key/value pair and the exact matching order above) and update `freesound.test.ts` to assert against this real dictionary (e.g. `"tiếng tích tắc đồng hồ"` → `"clock ticking"`, `"tiếng súng"` → `"gunshot"`) instead of the invented one. Re-run `npx vitest run src/server/shared/freesound/freesound.test.ts` and confirm green before committing.

Commit as a fix, e.g. `fix(freesound): match reference Vietnamese keyword dictionary exactly`, with `AGENTS.md`/`MODULE.md` updated to note the correction (remove the "decision outside spec" note about inventing a default mapping, since it's now an accurate port).

Everything else in the Phase 5 Prompt 1 acceptance report looks correct and was spot-checked against the code (volume constants `0.31622777`/`0.1`, `resolveFilePath` cross-project ownership check, `duplicateProject` clearing all five media reference fields). Once this fix lands, Phase 5 Prompt 1 is accepted.
