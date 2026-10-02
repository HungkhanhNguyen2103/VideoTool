# Task 38 — per-project on/off switch for keyword pop-ups

Small and bounded, so implement directly (no design round needed).

## What
Keyword pop-ups (Task 37) are currently always on for Remotion renders. Add
a per-project toggle.

1. **Field.** `keywordPopupsEnabled: z.boolean().default(true)` on
   `ProjectDocSchema` and `ProjectDetailSchema`. It is legacy-safe, so
   existing projects stay ON. Wire it through `createProject` defaults and
   `toDetail`. Duplication copies the value, since it's a setting, not a
   file.
2. **Setter + route.** `setProjectKeywordPopups(id, enabled)` in the project
   service, mirroring `setProjectRenderEngine`. Add
   `PATCH /api/project/:id/keyword-popups` with a strict body
   `{ enabled: boolean }`. Put it next to `render-engine` in
   `src/server/modules/video/routes.ts`, since this is a render setting.
3. **Props.** In `remotion-props.ts` (line ~113), pass `keywords: []` when
   `project.keywordPopupsEnabled === false`. Keep the existing
   audioFileId-match rule otherwise. This applies to both the full render
   and the single-scene preview.
4. **Studio UI.** A single checkbox labelled "Chữ pop-up" near the
   render-engine selector in the BGM/render header area. It is disabled while
   `busy`, calls a client helper `setKeywordPopups(projectId, enabled)`, then
   `refresh()` and shows a toast. When the render engine is FFmpeg, keep the
   checkbox visible but disabled, with a short hint that it only applies to
   Remotion (FFmpeg has no pop-ups).

## Tests
- Route: valid true/false persists; non-boolean or extra keys → 400.
- Legacy doc without the field parses as `true`.
- `remotion-props`: disabled → every scene has `keywords: []`; enabled with
  matching timings → keywords present (existing behaviour).
- Client helper test: PATCH URL and body.

## Non-goals
No change to the keyword picker, fonts or rendering visuals. No creation-form
field.

No visual verification needed: the render output is either the existing
approved pop-ups or none. Report the commit hash and
typecheck/lint/test/build results.

**STOP after this report.**
