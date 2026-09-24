# Visual-parity gap: ReviewScriptPage stepper doesn't match the approved prototype

This isn't a new bug in the fix you just shipped (`de75a7c`) — the *logic* correction there is right. This is a separate finding: the stepper's whole visual design in `ReviewScriptPage.tsx` never matched the ground-truth prototype at `docs/prototypes/duyet-tai-tao/`, which is already committed in this repo (I diffed the user's reference file against it — byte-identical, so it's still the current design source of truth). Screenshot comparison confirms it: the live page renders a flat row of plain text labels, no dots, no connector lines, no color-coded step state — where the prototype specifies numbered/checkmark dots joined by a progress line.

## What the prototype actually specifies

`docs/prototypes/duyet-tai-tao/app.js`, `renderStepper()`:

```js
function renderStepper(approvedCount, allApproved) {
  const steps = [
    { label: 'Dàn ý', sub: 'Hoàn tất', state: 'done' },
    { label: 'Nháp kịch bản', sub: 'Hoàn tất', state: 'done' },
    {
      label: 'Duyệt & tái tạo',
      sub: allApproved ? 'Hoàn tất' : `Đã duyệt ${approvedCount}/${chapters.length}`,
      state: allApproved ? 'done' : 'active',
    },
    { label: 'Chốt & chia cảnh', sub: allApproved ? 'Sẵn sàng' : 'Chưa bắt đầu', state: allApproved ? 'active' : 'todo' },
  ];
  // each step renders a numbered dot (or a checkmark icon once done), a connector
  // line to the next step (colored green once done), a label, and the sub text
}
```

`docs/prototypes/duyet-tai-tao/styles.css`, lines 218–231 — the dot/line component:

```css
.stepper { display: flex; align-items: center; gap: 16px; }
.step { display: flex; align-items: center; gap: 12px; flex: none; }
.step__dot {
  width: 36px; height: 36px; border-radius: 50%; flex: none;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); color: var(--text-3); border: 1px solid var(--border-2);
}
.step__label { font-size: 14px; font-weight: 600; color: var(--text-3); }
.step__sub { font-size: 12px; color: var(--text-3); }
.step.is-done .step__dot { background: var(--green-bg); border-color: var(--green-bd); color: var(--green); }
.step.is-done .step__label { color: var(--text); }
.step.is-active .step__dot { background: var(--amber); border-color: var(--amber); color: var(--amber-ink); font-weight: 700; }
.step.is-active .step__label { color: var(--amber-text); }
.step__line { flex: 1; min-width: 24px; height: 2px; border-radius: 2px; background: var(--border-2); }
.step__line.is-done { background: var(--green-bd); }
```

All of `--green`, `--green-bg`, `--green-bd`, `--amber-ink`, `--amber-text`, `--border-2` already exist in `src/client/styles/tokens.css` — no new tokens needed, this is a direct, drop-in port.

## What's different from what's actually in `ReviewScriptPage.tsx` today

1. **No dots, no connector lines, no per-step color state.** The current markup is a bare `<li>` with two `<span>`s (label text, sub text) — no `step__dot` (numbered circle that becomes a green checkmark once done), no `step__line` between steps (gray, turns green once the step before it is done).
2. **Step 3's sub-label doesn't match.** Current: static `'Đang thực hiện'`. Prototype: dynamic progress — `` `Đã duyệt ${approvedCount}/${chapters.length}` `` (e.g. "Đã duyệt 2/5") until `allApproved`, then `'Hoàn tất'`. This is a real content gap, not just styling — the design intent is to show live approval progress, not a generic "in progress" label.
3. **"Active" step highlighting doesn't move.** In the prototype, step 3 is the highlighted (`is-active`, amber dot) step until all chapters are approved, then step 3 flips to `is-done` (green) and step 4 becomes `is-active` (amber) — the amber highlight visually travels forward as the user approves chapters. The current implementation has no equivalent state-color transition at all, only plain text changes.

## What to do

Port `renderStepper()`'s logic and the `.step`/`.step__dot`/`.step__line` CSS from `docs/prototypes/duyet-tai-tao/` into `ReviewScriptPage.tsx` / `ReviewScriptPage.module.css` as real React markup (map over a `steps` array with `{ label, sub, state }`, render a dot span that shows the step number or a checkmark icon when `state === 'done'`, and a connector `step__line` between steps, `is-done` when the step before it is `done`). Extend the existing `getReviewStepperState` helper (from `de75a7c`) to also return each step's `state` (`'done' | 'active' | 'todo'`) and the dynamic `Đã duyệt X/Y` sub-label for step 3, driven by `chapters.filter(c => c.status === 'approved').length` and `chapters.length` — keep it a pure, testable function like it is now, just extend its return shape and add cases to the existing test file for the "some approved, not all" progress-count state and for step-4 becoming active once `allApproved`.

Steps 1–2 ("Dàn ý", "Nháp kịch bản") stay hardcoded `done` per the prototype — that part of the original implementation was actually correct against the design; only keep your `de75a7c` empty-state handling (showing "Chưa bắt đầu"/"Đang thực hiện" for step 2 before any chapters exist) since the prototype doesn't model the pre-generation empty state at all — that was a reasonable adaptation for a case the static prototype doesn't cover, no need to revert it.

Since `docs/prototypes/duyet-tai-tao/` is already committed in this repo, read it directly rather than working from this message alone — I've quoted the relevant slice above but the full file has the icon markup (`#i-check` SVG symbol reference) you'll want for the dot's checkmark.

Small scope, no design/plan doc needed — fix, extend the existing regression tests, report the commit hash.
