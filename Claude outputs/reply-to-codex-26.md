# Bug fix required: ReviewScriptPage — stepper state is hardcoded, and the page's CSS uses design tokens that don't exist

Found via screenshot + source read, not a spec/plan item — this is a defect in already-shipped Phase 3 UI (`src/client/features/script/ReviewScriptPage.tsx` and its CSS module). Two independent bugs in the same file pair; fix both in one pass.

## Bug 1 — stepper sub-labels are hardcoded by array index, not derived from real state

`ReviewScriptPage.tsx`, the stepper render:

```jsx
<ol className={styles.stepper} aria-label="Tiến trình sản xuất">
  {['Dàn ý', 'Nháp kịch bản', 'Duyệt & Tái Tạo', 'Chốt & Chia Cảnh'].map((label, index) => (
    <li className={styles.step} key={label} aria-current={index === 2 ? 'step' : undefined}>
      <span className={styles.stepLabel}>{index + 1}. {label}</span>
      <span className={styles.stepSub}>{index < 2 ? 'Hoàn tất' : index === 2 ? 'Đang thực hiện' : allApproved ? 'Sẵn sàng' : 'Chưa bắt đầu'}</span>
    </li>
  ))}
</ol>
```

Steps 0–2 ("Dàn ý", "Nháp kịch bản", "Duyệt & Tái Tạo") are hardcoded by `index` — they always show "Hoàn tất", "Hoàn tất", "Đang thực hiện" respectively, regardless of whether a script has actually been generated. Only step 3 reads real state (`allApproved`). Reproduce: open a project with zero chapters (`chapters.length === 0`, no `jobId`) — the page correctly shows the "Nháp kịch bản" / "Tạo kịch bản" empty-state panel below, but the stepper above simultaneously claims "Nháp kịch bản: Hoàn tất" and "Duyệt & Tái Tạo: Đang thực hiện", which is self-contradictory and confusing.

Fix: derive each step's sub-label and the current step from `chapters.length` and `jobId`, the same signals the panel below already switches on:

```jsx
const hasChapters = chapters.length > 0;
const currentStep = !hasChapters ? 1 : allApproved ? 3 : 2;
const stepSubs = [
  'Hoàn tất', // Dàn ý — brief/project already exists by the time this page is reached
  hasChapters ? 'Hoàn tất' : jobId ? 'Đang thực hiện' : 'Chưa bắt đầu', // Nháp kịch bản
  !hasChapters ? 'Chưa bắt đầu' : allApproved ? 'Hoàn tất' : 'Đang thực hiện', // Duyệt & Tái Tạo
  allApproved ? 'Sẵn sàng' : 'Chưa bắt đầu', // Chốt & Chia Cảnh (unchanged)
];
```

Then render `aria-current={index === currentStep ? 'step' : undefined}` and `<span className={styles.stepSub}>{stepSubs[index]}</span>`. Exact variable names are up to you — the behavioral contract is: the stepper must never show two adjacent steps as simultaneously "Hoàn tất" and "Đang thực hiện" when the panel below is in the empty/pre-generation state, and once chapters exist and get approved, "Duyệt & Tái Tạo" should flip to "Hoàn tất" and "Chốt & Chia Cảnh" should become the active step.

## Bug 2 — the page's CSS module references design tokens that don't exist anywhere in the app

`ReviewScriptPage.module.css` uses `var(--surface, #fff)`, `var(--line, #ddd)`, `var(--muted, #6b7280)`, `var(--accent, #555)`, `var(--surface-subtle, #f7f7f8)` throughout (`.stepper`, `.chapter`, `.stepSub`/`.muted`, `.chapterNo`, `.regen`, `.footer`). None of `--surface`, `--line`, `--muted`, `--accent`, `--surface-subtle` are defined anywhere — I grepped every CSS file under `src/client` and the only place these names appear is this one module. The app's real token set lives in `src/client/styles/tokens.css` under `:root`: `--bg`, `--panel`, `--panel-2`, `--border`, `--text`, `--text-2`, `--text-3`, `--amber`, etc. (dark theme).

Because the tokens this file references don't exist, every `var(--x, fallback)` silently resolves to its hardcoded light-mode fallback — `#fff` backgrounds, `#ddd` borders, `#6b7280` gray text — on every element in this page: the stepper card, every chapter card, the regen box, the history panel, and the sticky footer bar. That's why they render as bright white/light-gray boxes sitting on the app's dark navy page background, and why the disabled "Chốt & chia cảnh" button (styled amber-on-dark) is nearly unreadable — it's sitting on a near-white footer instead of the intended dark one.

Fix: replace every non-existent token in `ReviewScriptPage.module.css` with the real one from `tokens.css`, and drop the hardcoded light-mode fallback values (they're masking the real theme):

| Used now (doesn't exist) | Replace with |
|---|---|
| `--surface` (outer panels: `.stepper`, `.chapter`, `.footer`) | `--panel` |
| `--surface-subtle` (nested panel: `.regen`) | `--panel-2` |
| `--line` (borders) | `--border` |
| `--muted` (`.stepSub`, `.muted`) | `--text-3` |
| `--accent` (`.chapterNo`) | `--amber` or `--text-2` — pick whichever reads better for a chapter number badge; `--amber` matches the brand accent used elsewhere |

Check `.textarea`, `.history`, `.error` and any other rule in this file too — same file, same root cause, so scan the whole module rather than just the selectors listed above in case something was missed. After the fix, this page should visually match the dark theme used by the rest of the app (e.g. the project init/list pages) with no light/white panels breaking the theme.

## Scope note

Both bugs are isolated to `ReviewScriptPage.tsx` + `ReviewScriptPage.module.css`. I checked — no other client CSS module uses the fake token names, so this doesn't need a broader sweep.

Commit as a fix, e.g. `fix(script): correct review-page stepper state and theme tokens`, with a one-line note in `AGENTS.md`/the script module's `MODULE.md` if one exists for this page. No design/plan doc needed for something this size — just fix, verify visually (or with a snapshot/test if you have one), and report back with the commit hash so I can re-check.
