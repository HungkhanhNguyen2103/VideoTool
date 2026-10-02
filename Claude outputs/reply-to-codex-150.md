# Task 53 - Fix "AI returned invalid script structure" (DeepSeek outline/expansion)

## Symptom (Hung, real run after Task 52)
Network/key OK now. Project "The Vasa", preset documentary, 3 chapters, 300s, en, DeepSeek.
"Tao kich ban" fails with toast `AI returned invalid script structure.` (AppError 422 SCRIPT_PARSE_ERROR from `parse-output.ts`).
We cannot see WHY: `validate()` throws a generic error and drops both the raw text and the zod issues.

## Root causes found by reading code
1. `buildOutlinePrompt` (build-prompt.ts ~l.112) says each chapter needs `role` but never lists the allowed values.
   `NARRATIVE_ROLES = ['hook','context','rising','climax','resolution']` (contracts/script.ts) and the schema is `z.enum` + `.strict()`.
   A model inventing "introduction"/"conflict"/"setup" fails the whole outline.
2. `openLoops` must be `{question: string, plantedInChapter: int>0, resolvedInChapter: int>0}[]`; the prompt gives no shape.
   Strings or `chapter` keys fail. Every object schema is `.strict()`, so any extra key (e.g. `summary`, `wordCount`) fails.
3. Expansion schema has tight limits (styleNote<=500, chapterSummary<=250, avoidRepeating<=5 items of <=80, persistentFactsNext<=5 of <=120)
   that the model exceeds easily.
4. No JSON mode: DeepSeek may wrap JSON in prose/fences or add commentary.

## Do
A. **Diagnostics first (small, separate commit `fix(script): report AI schema validation details`)**
   - In `parse-output.ts` `validate()`: on zod failure throw `AppError('AI returned invalid script structure: <first 3 issues as "path: message">', 422, 'SCRIPT_PARSE_ERROR')`.
   - In `service.ts` `generateScript`: before rethrowing a SCRIPT_PARSE_ERROR, `context.appendLog` the issues and the first 400 chars of the raw text
     (raw text is model output, contains no secrets; still never log headers/keys).
B. **Prompt contract (commit `fix(script): spell out the JSON contract in script prompts`)**
   - Outline prompt: list allowed `role` values verbatim, give one compact example object for a chapter and for an openLoop
     (integers, not strings), say "no extra keys", keep `targetWords` integer, total words = budget, chapter count exact.
   - Expansion prompt: state the length caps explicitly ("styleNote max 500 chars, chapterSummary max 250 chars, avoidRepeating max 5 items each max 80 chars ...").
   - Apply the same contract text to the manual prompt so manual-import and auto agree. Bump `promptVersion`.
C. **DeepSeek JSON mode**: in `deepseek.ts` add optional `opts.json?: boolean` -> `response_format: { type: 'json_object' }`;
   pass `json: true` from the outline and expansion calls only (prompts already contain the word "JSON"). Also set a sane `maxTokens`
   (outline 4000, expansion 6000) so replies are not truncated; a truncated reply is another cause of invalid JSON.
D. **One repair retry**: if parse/validate fails, call the model once more with the original messages + the failed reply +
   "Your JSON was invalid: <issues>. Return the corrected JSON only." Only then fail. Keep existing length-retry logic intact.
E. **Tests**: (1) invalid role -> error text names `chapters.0.role`; (2) repair retry succeeds on second reply; (3) fails cleanly after the retry
   with issues in the job log; (4) `json:true` sends `response_format`; (5) prompt text contains all five role values.

## Do NOT
Loosen schemas (keep `.strict()` and enums), change ChapterDoc/Project contracts, touch scene/asset/video code, add dependencies.
Do not log the API key or request headers.

## Verify and report
Commit hashes, focused test output, typecheck/lint EXIT codes. Then a REAL run with DeepSeek on this project:
title "The Vasa - Warship That Sank in 20 Minutes", language en, preset documentary, 300 s, 3 chapters
(brief and references are in Hung's chat; ask him to paste them into Studio). Report: did the outline pass first try, did the repair retry fire,
chapter word counts vs targetWords, and paste the job log.
