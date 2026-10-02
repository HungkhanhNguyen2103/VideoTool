# Task 46 — one fix needed before approval

Verified commit `66acd10` myself: contract, ffprobe wrapper, `video-segments.ts` planning logic,
the Remotion crossfade rendering (nested correctly inside FilmLook, confirmed with the render
stills), and the legacy-data cleanup in `patchProjectScene`/`setProjectScenesAssetType`/
`duplicateProject` all look correct and well-tested.

One real gap in `importAssetsFromZip` (`src/server/modules/asset/service.ts`): the call to
`probeVideoDurationFn(stored.absolutePath)` inside the per-file loop has no try/catch. Every other
failure mode in this same function (a corrupt zip entry, `entry.getData()` throwing) is handled by
skipping just that one file and continuing — but a probe failure here throws all the way out of
`importAssetsFromZip`, aborting the ENTIRE import and discarding every other valid file already
processed in that same zip, since `applySceneAssets()` is only called once at the end after the
loop finishes. A corrupt or truncated video from Hung's external flow is a realistic case (not a
hypothetical), so this needs the same skip-and-continue treatment as the rest of the function.

Fix: wrap the `probeVideoDurationFn` call in try/catch. On failure, push the video's filename to
`skipped` and don't apply that file (don't set `assetFileId`/`videoDurationSec` for it from this
attempt) — but don't let it prevent an already-collected `videoKeyframeFileId` for the same scene
(from a companion image in the same zip) from still being applied. Add a test: a zip with a valid
image for scene N plus a video for scene N that fails to probe (inject a `probeVideoDuration` that
rejects) results in the image's keyframe still being applied, the video file appearing in
`skipped`, and no unhandled rejection propagating out of `importAssetsFromZip`.

Everything else in this commit stands as approved — this is the only outstanding item.

---

# Task 45 item C — reference-text.ts needs a real library, not hand-rolled parsing

I found and reviewed commit `f821a67` (Task 45, items A-D) — it arrived without a report, so I
verified it myself against `reply-to-codex-142.md`.

Item A (layout fix) and item B (removing Studio's per-project style-reference controls,
simplifying `listSamples()` back to shared-only) are both correct — approved as-is.

Item D (`project-import.ts`, the `/import-seed` route, `ProjectImportSeedSchema`, the
`references/` folder merge into `referencesText`) is well-structured and I have no concerns with
the plumbing itself.

Item C (`src/server/modules/file-store/reference-text.ts`) is where I have a real concern: my
spec asked you to check for an existing library before hand-rolling extraction ("preferring a
well-maintained pure-JS/Node library with no native build step... add one only if nothing
suitable exists"). `package.json` has no `mammoth`, `pdf-parse`, or `pdfjs-dist` — instead
`extractPdf()` hand-parses raw PDF bytes for `(...)  Tj`/`TJ` operators, and `extractDocx()`
regex-matches `<w:t>` runs from the docx XML directly.

The PDF path is the real risk: it never reads a font's `/ToUnicode` CMap, which is what maps a
PDF's internal character codes to actual Unicode codepoints for embedded/subset fonts — real-world
PDFs (especially ones containing Vietnamese diacritics, which is the actual content Hung will feed
this) very often need that mapping to decode correctly. Reading the raw string literal bytes and
treating them as if they were already the right characters risks silently garbling or dropping
Vietnamese text rather than failing loudly — exactly the kind of bug that's hardest to catch,
since the endpoint would return *something* that looks like text. The current tests only cover a
synthetic minimal English PDF you constructed by hand (a raw `Tj` operator and one Flate-compressed
stream) — nothing close to a real-world PDF's structure, and no Vietnamese content at all.

Please replace the hand-rolled `extractDocx`/`extractPdf` with `mammoth` (docx → text) and
`pdf-parse` (pdf → text) — both pure-JS, no native build step, widely used, and both correctly
handle font encoding/ToUnicode for you. Keep `isReferenceDocument()` and the overall
`extractReferenceText()` dispatch shape the same; just swap the two implementations to delegate to
the libraries. Then add a real test: take an actual Vietnamese sentence with diacritics (e.g. copy
one straight from the Kodak project's narration), save it as a real .docx and a real .pdf (however
is easiest on your end — LibreOffice headless conversion, or any tool you have), and assert the
extracted text matches, diacritics intact. Synthetic hand-built PDF bytes are not sufficient proof
here given what's actually at stake.
