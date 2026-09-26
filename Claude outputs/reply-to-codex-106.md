# Task 31 — Custom style reference: upload image + get style prompt

## Housekeeping first
`.git/index.lock` exists (dated Sep 25 17:30, size 0). Please check there's no
active git process on your end before removing it — if it's stale, delete it
so commits aren't blocked.

## Context
User request (translated): "I need to add 2 more [things] to the visual style
picker: 1) upload an image file matching the style, 2) a button to get a
prompt so I can go generate an image [in an external tool] and upload it."

This is scoped **per project**, not a change to the global preset library
(the bundled `cinematic.jpg` sample from Task 30 stays as-is). I confirmed with
the user this lives on the **Studio page** (`StudioPage.tsx`), next to the
existing visual-style `<select>` from Task 27/28 — NOT on `NewProjectForm`,
because a project must already exist to attach an uploaded file to it (the
generic upload route needs a `projectId`).

## What to build

**1. New project field** — `customStyleReferenceFileId: z.string().nullable().default(null)`
on `ProjectDocSchema` (`src/server/modules/project/docs.ts`) and
`ProjectDetailSchema` (`src/contracts/project.ts`), alongside the existing
`bgmFileId`/`renderFileId` pattern. Wire through `service.ts`'s create
defaults + `toDetail` projection.

**2. Setter** — `setProjectCustomStyleReferenceFile(id, fileId: string | null)`
in `src/server/modules/project/service.ts`, mirroring `setProjectBgm`
(atomic conditional update, same shape). Export from
`src/server/modules/project/index.ts`.

**3. Route to persist the uploaded file id** — a small PATCH route, e.g.
`PATCH /api/project/:id/style-reference` with body `{ fileId: string | null }`
(Zod-validated), calling the new setter. Follow the exact pattern of the
existing `visual-style` PATCH route in `src/server/modules/script/routes.ts`
(Task 27) — same file is fine, or wherever you judge fits best.

**4. Reuse the existing generic upload route** — `POST /api/project/:id/files`
(`src/server/modules/file-store/routes.ts`) already handles multipart upload
via `storeFile()`. Add `'style-reference'` to `FILE_PURPOSES`
(`src/contracts/file.ts`) so this upload's purpose is distinguishable from
`'reference'`/`'bgm'`/etc. Client flow: upload via that route with
`purpose: 'style-reference'` → get back a `FileSummary` with its id → PATCH
that id onto the project via the new route in step 3 → refresh.

**5. New read-only endpoint for the style prompt** — `GET
/api/project/:id/visual-style-prompt` (or nest under the existing script
routes) returning `{ style: string }`, where `style` is
`loadVisualStylePreset(project.visualStylePresetId).style` — the same
`## Style` directive text already used internally for AI prompt-building
(`src/server/modules/script/ai/presets/visual-style-loader.ts`). No AI call
needed, it's a pure sync file read + regex extract that already exists.

**6. Client UI** — in `StudioPage.tsx`, next to the visual-style `<select>`
(around line 215), add:
   - An **"Upload ảnh"** button (hidden `<input type="file" accept="image/*">`
     triggered by a visible button, same UX pattern as any existing file
     input in this app if one exists — check `AssetPage.tsx`/scene asset
     upload for a precedent). On file pick: POST to the upload route with
     `purpose: 'style-reference'`, then PATCH the returned file id, then
     `refresh()`. Show the current uploaded reference (if
     `project.customStyleReferenceFileId` is set) as a small thumbnail via
     `fileUrlForSummary`, with a way to remove/replace it (PATCH `{fileId:
     null}` clears it).
   - A **"Get prompt"** button that GETs the new endpoint and shows the
     returned `style` text somewhere the user can copy it (a simple toast,
     inline `<textarea readonly>`, or a small popover — your call, keep it
     minimal). No need for a copy-to-clipboard library; a selectable
     `<textarea>` is fine.

## Non-goals (explicit)
- Do NOT feed the uploaded reference image into the actual AI image
  generation pipeline (no img2img/reference-conditioning) — this is purely a
  user-facing reference/documentation aid for their own external workflow.
- Do NOT touch `NewProjectForm.tsx`'s existing style preview (Task 30) —
  that stays project-creation-time only, no upload capability there.
- Do NOT change `loadVisualStylePreset`'s internal signature/behavior — only
  add a thin route that calls it.

## Process
Given this touches contracts + file-store + project service + a new route +
client UI, please propose a short bounded design in chat first (like Task 26)
rather than a full spec/plan — I'll review and approve before you implement.
Report back with commit hash(es) plus test results (asset-api tests + any
new ones; MongoDB-backed tests may still fail in my sandbox, that's expected,
just tell me what you ran locally).

**STOP after this report.**
