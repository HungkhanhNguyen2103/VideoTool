# Task 98 plan

Preconditions: `git status --short --branch` shows `main` at `a9a80be`; tracked tree is clean. The provided `docs/superpowers/tasks/task-98-inactive-scenes.md` is untracked and will not be staged.

Route: add `PATCH /:id/scenes/:sceneId/active` to `video/routes.ts`; use one scene-write guard list covering `render-full-video`, `generate-voiceover`, `align-word-timings`, `analyze-popups`, `generate-all-sfx`, `generate-depth-maps`, `generate-depth-map`, `generate-visual-prompts`, `split-scenes`, `generate-script`, `final-qa`, `regenerate-chapters-claude-cli`, checking each via `getActiveJobByType`.

Shared contract helper: `src/contracts/scene-active.ts` exports `isSceneActive`, `activeScenes`, and `countInactiveScenes`; missing `active` means active. Project service owns `setProjectSceneActive` and a shared server guard for single-scene actions. A same-value request succeeds without a version bump; an actual toggle increments version and updatedAt.

| Audit area | Plan |
|---|---|
| Voiceover batch/start scene; single voiceover | Skip inactive in batches; inactive start target/single action returns 409. |
| Image/video, keyframe/tail generation; SFX batch/single; alignment; depth maps batch/single; duration recompute | Skip inactive in batches with `skippedInactive`; reject inactive single targets. |
| Name-keyword preview/selection and popup analysis/auto-analysis | Exclude inactive from popup candidates, AI chunks/context, counts, timeline offsets; preserve stored plans; reject inactive plan edits/flags. |
| Visual prompt route/worker/project writer and readiness | Exclude inactive from AI/fill; readiness ignores them; preserve original scene indexes in inputs/logs. |
| ZIP import/export, asset type, video distribution, fit-to-clip | Skip or omit inactive, retain original indexes/numbers, count ZIP skips; fit-to-clip returns 409. |
| Worker registry and project mutations | Apply skips to corresponding handlers, including align-triggered popup analysis; inactive depth-map handler skips; duplicate preserves flag/data; project list counts active scenes/duration. |
| Single-scene preview, voice/SFX/depth-map/fit, popup edits | Shared server guard returns `409 SCENE_INACTIVE`; Studio disables with Vietnamese tooltip. |
| FFmpeg, Remotion, staging, composition, transitions, mixing | Filter once at full-render entry `video/service.ts::renderFullProject` before readiness and builders; inactive scenes are absent from final video. Preview uses the active project context and rejects an inactive target. |
| SEO timestamps/package and SEO/video AI prompts | Use active timeline; all-inactive chapters are omitted with a warning; exclude inactive scenes from AI input. |
| Audio-only listen, totals/readiness/progress | Active scenes only; preserve original displayed scene numbers. |
| Studio | Add detail/list switches, muted badge/row, active/inactive counts, batch touch counts/toast summaries, disabled actions, keyboard support. |
| QA, chapter regeneration, scene split, finalize | Out of scope: inspect and report whether existing flags survive; new split scenes default active; no behavior changes. |

Render freshness: persist the ordered active scene IDs used for the final render in project data; Studio compares that snapshot with current `activeScenes`. On toggle, mismatch shows “đã thay đổi sau lần render”. Preview fingerprints include the ordered active scene IDs, so a change to an earlier scene invalidates later previews whose timeline context changes.

Risks: video-distribution chapter/index mapping, global indexes returned by `applyEmptySceneVisualPrompts`, chapter duration summaries, and preserving popup plans/data while active context changes. I’ll verify legacy render freshness compatibility and the exact scene-split behavior before implementing those paths. No blocking questions for Hung.

Parts A/B/C follow the task file order, with one commit and an @planner review after each; update Status and touched module docs in each commit. Real checks use only a disposable duplicate, mock image generation, and stub popup/SFX where paid calls are not authorized. No push.

## Part B plan

Preconditions observed: `main`, HEAD `9fc1d239e3c613ff675ef5e10c1b64ab890fcdeb`; tracked tree clean (only the two Task 98 planning documents are untracked and will remain unstaged).

| Area | Files / decision / regression tests |
|---|---|
| Full render | `video/service.ts`: filter active scenes once in `renderFullProject` before readiness/builders; inactive scenes are omitted from final output and active neighbors become transition neighbors. Extend `video.test.ts` for readiness, frames, original order, and no inactive inputs. |
| Preview context and timeline | `video/remotion-props.ts`, `remotion.test.ts`, and existing FFmpeg/timeline tests: stage the selected active scene only, but resolve keyword/year/film-look context from the full active project; assert props match a render with inactive scenes removed. |
| Final-render snapshot | `project/docs.ts`, `contracts/project.ts`, project service/repo tests: add optional ordered `renderedActiveSceneIds`; atomically write it with `renderFileId` in `setProjectRenderFile` for completed full renders only; clear it on duplicate. Missing snapshot means legacy and never stale. |
| SEO timeline and package | `contracts/seo-format.ts` and `seo-format.test.ts`: use active scenes and frame-rounded timing; omit chapters with no active scenes and add a warn-only message. Verify descriptions/checklists/Markdown use active-only timestamps. |
| AI inputs | `seo/ai/build-prompt.ts` and its tests; video AI build-prompt/parse-output tests: omit inactive scenes from prompt context and ignore inactive scene output. Name-keyword AI filtering is already covered by Part A. |
| Freshness and listening | `client/features/asset/scene-preview.ts` + tests: compare active set for project freshness and fingerprint active IDs so later context-dependent previews stale; add a Vietnamese changed-field reason. `voiceover-listen.ts` + tests: queue active scenes only and skip/pause safely if refetched current scene becomes inactive. |
| Docs and verification | Update `AGENTS.md` Status and project/video/SEO/asset module docs touched by the changes. Run focused tests with deliberate reverted-source RED checks, then typecheck/lint and source-encoding scan; full gates and real duplicate acceptance remain final verification steps. |

No blocking questions. Please review this Part B scope before implementation.
