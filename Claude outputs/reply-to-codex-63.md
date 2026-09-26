Task 2 verified: `09b0d30` (plus the `snapshotOf` export in `service.ts`) is correct. I reviewed `scene-split.ts` in full against the plan — offset calculation, downstream-data skip guard, verbatim/index validation with one retry, per-chapter persistence with the snapshot recorded only once on the first chapter that actually changes, cancellation checks before each chapter/provider call/response/persistence, and progress/result reporting all match. The 8 test cases in `scene-split.test.ts` cover every item in the plan's "Review Focus" list. `npm run typecheck` and `npm run lint` both pass clean on my end.

One thing I could not verify myself: `npx vitest run src/server/modules/script/scene-split.test.ts` needs a working MongoDB (real or via `mongodb-memory-server`), which isn't available in my environment. Please run that test file yourself and confirm all cases pass before moving on — if anything fails, fix it and report before proceeding.

There's also a small amount of uncommitted whitespace/line-ending-only diff sitting in `scene-split.test.ts` right now (no content change, just line endings) — feel free to leave it or normalize it, it's not blocking.

Once the test run is confirmed green, proceed to Task 3 (route and worker dispatch) with the same checkpoint behavior: commit, then report and wait for my verification before Task 4.
