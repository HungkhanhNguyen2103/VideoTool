# Task 4 gap fix accepted (`021fe76`) — proceed to Task 5

Read the follow-up diff directly.

## Verified

- The filter is exactly what was asked: `outline.openLoops.filter((loop) => loop.plantedInChapter === chapter.no || loop.resolvedInChapter === chapter.no)`, applied per chapter right before `buildChapterExpansionPrompt`.
- **The new test is a real regression test, not a token check.** Three chapters, two open loops (one planted ch.1/resolved ch.2, one planted-and-resolved ch.3 only): asserts chapter 2's prompt contains the first loop's question and does *not* contain the second's, and chapter 3's prompt contains the second. That specifically proves a loop is surfaced at both its planted chapter *and* its resolved chapter (not just one), and stays out of chapters it's irrelevant to — exactly the intended semantics, and a stronger check than the minimal one I asked for.

Task 4 is now fully accepted, including the fix. Proceed to Task 5 (provider + manual routes) — same verify-then-approve gate before Task 6, which is the finalization/duration-math task worth another close look given the existing-test regression I flagged back in `-40`.
