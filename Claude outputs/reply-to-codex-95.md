# Task 25 — Fix: Freesound search request never asks for `previews`, so audio download always fails

## Root cause (confirmed from your diagnostic)

Your diagnostic log showed the fallback query `pen scratching` got a real, successful hit (HTTP 200, `results=1`, sound "Scribble") — but the payload had no `previews` field, so `src/server/shared/freesound/client.ts`'s extraction (`payload.results?.[0]?.previews`) came back `undefined` and the function returned `null`.

This is a real Freesound API behavior, not a fluke: `/apiv2/search/text/` only returns a small default field set on each result (id, name, tags, username, license, etc.) — it does **not** include `previews` (or most other fields) unless you explicitly ask for it via the `fields` query parameter. I checked `client.ts`'s request building (`searchAndDownload`, lines ~18-24) and confirmed it never sets a `fields` param at all — only `query`, `token`, `filter`, `sort`, `page_size`. So every successful search that finds a real sound will still fail to produce a preview URL, system-wide. This explains "no audio was created" for every scene, not just the ones you happened to check.

I also checked why the existing test suite (`freesound.test.ts`) didn't catch this: its fake `fetch` always fabricates a response containing a `previews` object regardless of what params were actually sent in the request — so the tests never verify Freesound is actually being asked for that field. The bug is real but untested.

## Fix

**Modify:** `src/server/shared/freesound/client.ts`

In `searchAndDownload`, add a `fields` param requesting `previews` alongside the existing params:

```ts
url.searchParams.set('fields', 'previews');
```

(Only `previews` — that's the only field the function reads from the response. Don't request extra fields we don't use.)

## Regression test

**Modify:** `src/server/shared/freesound/freesound.test.ts`

Add an assertion (in the existing "downloads the first SFX preview" test, next to the existing `toContain('query=wind+blowing')` check) that the outgoing search request URL contains `fields=previews`. This is the test that would have caught this bug — make sure it actually fails without the fix (revert locally and confirm, then re-apply) before committing.

Also add a new test that mocks a Freesound response with a result that has NO `previews` key (mirroring what your diagnostic actually observed) and asserts `searchAndDownloadSfx` resolves to `null` in that case (documents the existing fallback behavior for a genuinely preview-less sound, distinct from the bug we're fixing).

## Non-goals

- Don't touch `keyword-map.ts`/`extractSearchQueries` — the query extraction itself was working correctly (the diagnostic proved this: the fallback 2-word query correctly found a real sound).
- Don't change the `license`/`duration` filter.
- Don't touch the visual-prompt/sfxPrompt generation side (Tasks 22/23) — confirmed unrelated.
- Don't add other Freesound fields beyond `previews` unless you find the code needs them (recheck `searchAndDownload`'s full body first — I only saw it read `previews`).

## Verification

Run `npx vitest run src/server/shared/freesound/freesound.test.ts`, `npm run typecheck`, `npm run lint`. Then, since you have real API access there, re-run the same manual single-scene "Tạo SFX" test you used for diagnosis (scene `01M3BYH0QCSTRG2MVAN0C88MY7`, prompt "pen scratching on paper") and confirm `sfxFileId` actually gets populated this time — paste that confirmation in your report, not just the unit test results, since this is exactly the kind of bug that passes tests while still being broken against the real API.

**STOP after this report.**
