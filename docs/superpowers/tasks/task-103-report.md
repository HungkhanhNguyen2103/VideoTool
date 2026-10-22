# Task 103 report — Per-scene Studio asset upload

Date: 2026-10-20

## Commit

- `05fe543` — `feat(asset): per-scene asset and keyframe upload in Studio`
- No push was performed.

## Implementation

- Added shared response/slot contracts and per-scene `POST`/`DELETE` routes.
- Refactored ZIP and direct uploads through the same internal store/attach, video probe, and tail-frame helpers without widening ZIP cleanup behavior.
- Validates the whole 1–2 file combination, strict MIME/extension agreement, empty files, 25 MB image limit, and 200 MB aggregate limit before storing any request file.
- A video clip is probed and its tail is extracted before one atomic `applySceneAssets` call. A combined clip/keyframe request is written by that same call. The database mutation guards the expected project version, scene activity, and scene type; legacy scenes with no stored `assetType` retain the schema's image default.
- If probe or project mutation fails, every new file stored for the direct request is deleted, including the extracted tail. Cleanup failures log warnings and preserve the primary result/error.
- Replacements collect the exact displaced set: clip replacement collects the former asset and tail; keyframe replacement collects only the former keyframe; image replacement also collects the prior depth-map file. After the project write, cleanup re-reads the project and keeps any ID still referenced.
- Studio adds XHR upload progress, Vietnamese errors, image/clip/keyframe controls, combined upload, remove actions, query refresh, and scene-preview invalidation. Feedback resets when the user moves to another scene.

## Final rules

| Scene type | Request files / delete slot | Project fields written |
|---|---|---|
| image | one image | `assetFileId`; existing depth map is invalidated by `applySceneAssets`; depth generation is requested |
| image | video, two files, or keyframe delete | rejected |
| video | one video | `assetFileId`, `videoDurationSec`, `videoTailFileId`; keyframe is preserved |
| video | one image | `videoKeyframeFileId`; clip, tail, and duration are preserved |
| video | one video + one image | all clip fields plus `videoKeyframeFileId` in one project mutation |
| video | two videos or two images | rejected before storage |
| either | `slot=asset` | `assetFileId`, `videoTailFileId`, and `videoDurationSec` become `null`; image depth map is cleared by the existing project helper |
| video | `slot=keyframe` | only `videoKeyframeFileId` becomes `null` |
| either | already-empty valid slot | successful no-op |
| inactive | upload or delete | rejected by the shared guard with `SCENE_INACTIVE` and the existing Vietnamese message |

## Reference cleanup audit

The refreshed project document is scanned recursively for every string stored under `fileId` or a key ending in `FileId`. This covers:

- scene `assetFileId`, `videoKeyframeFileId`, `videoTailFileId`, `audioFileId`, `sfxFileId`, depth-map `assetFileId`/`fileId`, word-timing `audioFileId`, and popup/name analysis `audioFileId`;
- project `renderFileId`, `draftRenderFileId`, `bgmFileId`, `logoFileId`, `customStyleReferenceFileId`, and SEO thumbnail `fileId`.

The visual-style sample/pack collections store generated relative paths rather than file IDs. File-store records own the binary metadata rather than acting as references. Job payload/result documents are generic historical/audit data and no module resolves media from them, so they were not treated as live file owners. No other durable live file-ID owner was found outside the project document.

## Verification

- Focused server/contracts: 2 files, 69 tests passed.
- Focused client: 4 files, 59 tests passed.
- Full suite: 101 files passed, 1 skipped; 1192 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed. Vite retained the existing informational chunk warning above 500 kB.
- Browser, disposable project `01M5D1GRFSAXYDS7FGAY7VT7FA`, exact 1920×1080 viewport: combined clip/keyframe upload, keyframe-only replacement, clip-only upload, image upload and replacement, wrong video-on-image Vietnamese error, inactive disabled controls/tooltips, live fit-to-clip enablement for a 4.0 s clip on a 2.7 s scene, and reload persistence were verified.

## Limitations and deviations

- The image remove button itself was not clicked during computer-use acceptance because graphical deletion requires a separate action-time confirmation. The delete route, response contract, client request, cache invalidation, no-op behavior, depth invalidation, conservative file cleanup, and inactive guard are covered by automated tests.
- The disposable duplicate and uploaded acceptance files were left in the local development data for inspection.
