# Task 16 — Expose AI provider selector on the Studio (Phân Cảnh & Xuất Video) page

(Supersedes the earlier draft in `Claude outputs/reply-to-codex-59.md` — same feature, refreshed against the current file layout after Task 14/15 edits shifted line numbers in `StudioPage.tsx`. Ignore the old file.)

## Context

`project.aiProvider` ('deepseek' | 'claude') already exists as a live-patchable, project-wide setting — `PATCH /api/project/:id/ai-provider` already exists (`src/server/modules/script/routes.ts`), and `api.setAiProvider` already exists client-side in `src/client/features/script/api.ts`, used today only on the "Duyệt và Tái Tạo" page (`ReviewScriptPage.tsx`, two `<select>` elements at lines 303 and 332). Every AI-backed action in this codebase reads `project.aiProvider` at call time via `getAiClient(project.aiProvider)` — this includes script generation/regeneration, final QA, `generate-visual-prompts`, and `split-scenes` — so it is not scoped to script review alone.

The Studio page (`src/client/features/asset/StudioPage.tsx`, route labeled "3. Studio Phân Cảnh & Xuất Video" in `Layout.tsx`) triggers `generate-visual-prompts` and `split-scenes` directly but currently has no way to see or change the AI provider without navigating back to the Review page. This task adds that control to the Studio page. The default provider stays `deepseek` — no schema/default change needed, this is purely a UI addition to an existing, already-working setting.

## Scope — file by file

1. **`src/client/features/asset/api.ts`**
   - Add `export function setAiProvider(projectId: string, provider: 'deepseek' | 'claude'): Promise<ProjectDetail>`, calling `PATCH /api/project/${projectId}/ai-provider` with body `{ provider }`, mirroring the existing implementation in `src/client/features/script/api.ts` exactly (same endpoint, same schema parse).
   - Add an `AI_PROVIDER_OPTIONS` constant mirroring `RENDER_ENGINE_OPTIONS` exactly, including sourcing values from the shared contract enum rather than hardcoding strings:
     ```ts
     export const AI_PROVIDER_OPTIONS = [
       { value: AI_PROVIDERS[0], label: 'DeepSeek' },
       { value: AI_PROVIDERS[1], label: 'Claude' },
     ] as const;
     ```
     Import `AI_PROVIDERS` from `../../../../contracts/project` alongside the existing `RENDER_ENGINES` import in this file.

2. **`src/client/features/asset/StudioPage.tsx`**
   - Add a `setAiProvider(provider: 'deepseek' | 'claude')` handler function mirroring the existing `setRenderEngine` function exactly (currently ~line 140): early-return if unchanged, `setBusy('ai-provider')`, call `api.setAiProvider(projectId, provider)`, `await refresh()`, toast success/failure, `finally setBusy(null)`.
   - Add a button-group selector inside the existing `<header className={styles.header}>` block (currently lines 170-179), placed between the `<Badge>` and the existing `<div className={styles.actions}>` (Copy JSON / Export JSON / Import ZIP). Structure and style it exactly like the render-engine selector already used lower on this same page (currently line 188, inside `mediaHeader`): `role="group" aria-label="AI provider"`, mapping `api.AI_PROVIDER_OPTIONS`, `variant={project.aiProvider === option.value ? 'indigoline' : 'ghost'}`, `aria-pressed={project.aiProvider === option.value}`, `disabled={busy !== null}`, `onClick={() => void setAiProvider(option.value)}`. (Note: the render-engine selector compares via `api.selectedRenderEngine(project.renderEngine)`, a same-value passthrough helper with no normalization logic — for AI provider just compare `project.aiProvider` directly; there's no need to add an equivalent passthrough helper.)
   - No changes to `generateVisualPrompts`, `splitScenes`, `renderProject`, or any other existing handler — they already read the current `project.aiProvider` implicitly via the server, since the server always reads `project.aiProvider` fresh at job-run time regardless of which page changed it.

## Non-goals — do not touch

- Do not touch `ReviewScriptPage.tsx` or its existing AI provider selects — leave them exactly as they are. Both pages read/write the same underlying `project.aiProvider` field, so no synchronization code is needed beyond each page's own `refetch()`/`refresh()` after a successful change.
- Do not add an AI provider selector to `NewProjectForm.tsx` — it already has one.
- Do not change the default value of `aiProvider` anywhere (stays `'deepseek'`).
- Do not add a provider selector to any other page.
- Do not change the `PATCH /:id/ai-provider` route or its server-side behavior — it already works correctly.

## Tests

- If `StudioPage.tsx` currently has no component-render tests (per this repo's established convention of testing only pure helper functions, not component rendering — check `chapter-actions.ts`/`chapter-actions.test.ts` pattern), do not introduce a new component-test methodology just for this.
- Add a focused unit test for `AI_PROVIDER_OPTIONS` and `setAiProvider` in `src/client/features/asset/asset-api.test.ts`, mirroring whatever test (if any) currently covers `RENDER_ENGINE_OPTIONS`/`setRenderEngine` in that same file — match the existing precedent exactly rather than inventing a new pattern.

## Process rules (same as every prior task in this repo)

Never run `git add -A` / `git add .` / `git commit -a` — stage only the exact files you changed, after checking `git diff --stat` first. Check for and remove a stale zero-byte `.git/index.lock` if no git process is actually running. Run `npm run typecheck`, `npm run lint`, and the relevant `vitest` files before reporting done. Keep the diff strictly to what's described above — no drive-by refactors, and do not touch the ~60 unrelated files this repo currently shows as line-ending-only diffs in `git status` (leave them alone entirely).

**STOP after this report.**
