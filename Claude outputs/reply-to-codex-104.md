# Task 30 — Fix "Khổ hình" row alignment + add a live preview thumbnail next to the Visual style select

Two independent parts, both in `NewProjectForm.tsx`/`.module.css`.

## Part A — Fix the "Khổ hình" (aspect ratio) column misalignment

The user pointed out the "Khổ hình" column in the "Cấu hình video" 4-column grid sits visually offset compared to its 3 siblings ("Độ phân giải" / "FPS" / "Giọng đọc mặc định").

Root cause: "Khổ hình" is the only one of the 4 columns built as a `<fieldset className={styles.segmented}><legend>...</legend>...</fieldset>`, while the other 3 are plain `<div className={styles.field}><label>...</label><select>...</select></div>`. `.field` is `display:flex; flex-direction:column; gap:8px` (8px between label and control), but `.segmented` is `display:flex; flex-direction:row` with its `legend` given `margin-bottom:2px` instead of participating in that gap — plus a `<legend>` inside a `display:flex` fieldset has inconsistent cross-browser layout behavior (it isn't a normal flex item the way a `<div>` child is). That mismatch in box model between the 4th column and the other 3 is what's producing the visible offset.

**Fix:** restructure the "Khổ hình" column to use the exact same box model as the other 3 fields, so all 4 columns are structurally identical:

```tsx
<div className={styles.field}>
  <span id="aspect-label">Khổ hình</span>
  <div className={styles.segmented} role="radiogroup" aria-labelledby="aspect-label">
    {ASPECT_RATIOS.map((value) => (
      <label key={value} className={styles.segmentedOption}>
        <input type="radio" value={value} {...register('renderSettings.aspect')} />
        <span className={styles.segmentedLabel}>{value}</span>
      </label>
    ))}
  </div>
</div>
```

i.e. drop the `<fieldset>`/`<legend>` entirely for this control, use a plain `<div className={styles.field}>` wrapper (matching the other 3 columns exactly) with a `<span>` acting as the visual label, and move `role="radiogroup"`/`aria-labelledby` onto the inner `.segmented` div instead (since it's no longer a real `<fieldset>`, this preserves the accessible grouping semantics without the fieldset/legend layout quirks). Update `.segmented`'s CSS if needed — it should no longer need its own `legend` rule (drop the now-unused `.segmented legend` CSS block in `NewProjectForm.module.css` after this change, so no dead CSS is left behind). Keep `.field > label` styling applying to the new `<span>` too (check the CSS selector `.field > label, .segmented legend` — split this if the `<span>` needs its own matching rule since it's no longer a `<label>` element; a `<span>` inside `.field` won't match `.field > label`, so add `.field > span` to that selector, or give the span the existing label's exact class treatment however is cleanest).

Don't change `ASPECT_RATIOS`, the radio input behavior, or anything about how `renderSettings.aspect` is registered — this is a pure structural/CSS fix, not a behavior change.

## Part B — Live preview thumbnail next to the Visual style select

The user asked for a way to see a sample image for each visual style option (a native `<select>` can't show images inside its options). Agreed approach with the user: keep the compact `<select>` (don't turn it into a card grid), and show a small preview thumbnail image next to it that updates to match whichever style is currently selected.

### Images

Real, already-generated sample images should be used where they exist — not fabricated/stock photos. As far as I can tell from this project's history, only the `cinematic` preset has actually been used to generate real scene assets so far (it's the default, and every project I've seen used it); `anime`/`watercolor`/`photorealistic`/`flat-cartoon` likely have no real generated asset yet. You have access to the real `data/files` storage and project history that I don't — please check:

1. Does any existing project's scenes have `assetFileId`s generated while that project's `visualStylePresetId` was something other than `cinematic`? If you find one, use that real generated image as the sample for that style.
2. For any style with no real generated sample available, do NOT fabricate a fake "sample" image — use a simple neutral placeholder instead (e.g. a plain labeled swatch, or omit the thumbnail and show short text like "Chưa có ảnh mẫu" under the select when that style is selected). Tell me in your report which styles ended up with a real sample vs a placeholder, so we can circle back and swap in real ones later as they get generated.

Store whatever images you do use under a new `src/client/assets/visual-style-previews/` directory (or wherever this codebase's convention puts static client images — check for an existing pattern before inventing a new one), one file per preset id (`cinematic.*`, `anime.*`, `watercolor.*`, `photorealistic.*`, `flat-cartoon.*`).

### UI

Next to the existing "Phong cách hình ảnh" `<select id="visual-style">`, add a small (~80×80px) preview thumbnail that shows the image file matching the currently selected `visualStylePresetId`, updating live on change (no extra click/confirm needed — it should just reflect whatever the select's current value is). If a given style has no image available (per the placeholder fallback above), render the "Chưa có ảnh mẫu" placeholder text/box instead of a broken `<img>`.

## Non-goals

- Don't turn the visual style control into a card grid — the user explicitly chose to keep the compact select + adjacent thumbnail.
- Don't add per-asset style tagging to the data model — this is a static, bundled reference image per preset, not something computed from a specific user's project data at runtime.
- Don't touch the Studio page's visual style select (Task 28) — this task is scoped to `NewProjectForm.tsx` only.
- Don't change the actual style directive text/behavior for any preset (Tasks 15/29) — this is purely a form UI addition.

## Tests

- If there's existing NewProjectForm test coverage, check whether it needs updating for the "Khổ hình" markup change (fieldset→div). If none exists for this component, say so rather than inventing a new test harness.

## Process rules (same as always)

Stage only the exact files changed, `git diff --stat` first. Never `git add -A`/`git add .`/`git commit -a`. Run `npm run typecheck`, `npm run lint`, and relevant tests before reporting done.

**STOP after this report.**

---

## Addendum (before you start, if you haven't already) — download button for the style preview thumbnail

The user also wants a small "Tải ảnh" (download) button next to the ~80×80 preview thumbnail added in Part B, so they can download that exact sample image file and use it as a reference/template image in an external image-generation workflow they run outside this app.

- Only applies to the preview thumbnail added in Part B of this task (not scene assets in Studio — confirmed out of scope with the user).
- A plain download works fine here: either a native `<a href={imagePath} download>Tải ảnh</a>` pointing at the bundled static image file, or an equivalent button using the same mechanism your framework already uses elsewhere for file downloads in this codebase (check `downloadJson`/similar in `StudioPage.tsx` or `api.ts` for the existing download pattern and reuse it if there's a shared helper — otherwise a plain anchor-with-download-attribute is sufficient since this is a static bundled asset, not something requiring an API fetch).
- Only show/enable the download button when the currently selected style actually has a real or placeholder image file to download — if you used the "Chưa có ảnh mẫu" text-only fallback for a style with no image (per Part B), don't render a download button for that state (nothing to download).
- Label: "Tải ảnh" is fine, or match whatever concise Vietnamese label style the rest of this form already uses for buttons.

**STOP after this report.**
