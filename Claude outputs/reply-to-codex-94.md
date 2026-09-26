# Task 24 — Diagnose: no SFX audio being generated at all

## Symptom

User reports Freesound SFX generation is producing **no audio for any scene** — logs show repeated `SFX skipped for scene <id>: Freesound returned no result.` warnings. This looks systemic, not a per-scene "AI intentionally left sfxPrompt empty" case.

## What I need first — diagnosis, not a fix yet

I can't reach `freesound.org` or read your real `.env` from my sandbox, so I need you to check directly on the machine where the worker actually runs:

1. **Is `FREESOUND_API_KEY` actually set (non-empty) in the real `.env`** used by the running server/worker? (Not `.env.example` — check the actual `.env` file, or wherever env vars are injected for the worker process.) Print whether it's set and non-empty — do NOT print the actual key value in your report.

2. **Pick one scene with a known, non-empty, plausible English `sfxPrompt`** (e.g. one of the ones from the screenshot, or a fresh one) and manually trigger SFX generation for just that scene (existing per-scene "Tạo SFX" button/route is fine). Capture the FULL worker log output for that one run, not just the final summary line.

3. **In `src/server/shared/freesound/client.ts`, temporarily add (or check if you can infer without changing code) which of these three paths is actually hit**:
   - `!query || !options.apiKey` → returns null immediately (key or query missing)
   - `!response.ok` → throws, caught, logs `'Freesound request failed; continuing without audio.'` with the error object (which includes the HTTP status in the Error message: `Freesound search returned ${response.status}.`)
   - `response.ok` but `payload.results` is empty or has no `previewUrl` → falls through, returns null silently (this is the "genuinely zero matching results" case)

   If it's not obvious from existing logs, add a temporary `logger.warn` (or `console.log`) right before each of these three return/throw points that identifies which branch fired and (for the HTTP path) the response status and raw response body — run the single-scene test from step 2 again, capture the output, then remove the temporary logging (or leave it if you think it's generally useful — your call, but tell me either way).

## Do NOT do yet

- Don't change the `license:"Creative Commons 0" duration:[0.3 TO 8.0]` filter.
- Don't change `keyword-map.ts` or `extractSearchQueries`.
- Don't touch the visual-prompt/sfxPrompt generation side (Tasks 22/23) — this is purely about why the *audio download* step is coming back empty.

## Report back

Tell me: which of the 3 branches fired, the exact `sfxPrompt` text used for the test scene, the HTTP status if it got that far, and whether `FREESOUND_API_KEY` was confirmed present (yes/no only, no value). Once I know which of these it is, I'll write the actual fix task (e.g. "surface a clearer config error if the key is missing" vs "loosen the filter" vs "the key needs rotating" — that last one only you/the user can act on, not me).

**STOP after this report — no code fix yet, diagnosis only.**
