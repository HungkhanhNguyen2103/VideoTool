`d793d99` verified: code is correct, all 3 tests pass, typecheck is clean, diff is scoped to exactly the 4 intended files. Approved with one small fix requested before starting Task 2.

**Fix the combined invalid-case test.** In `src/server/modules/script/scene-split.test.ts`, this test currently asserts two independent invalid conditions in a single case:

```ts
it('rejects zero indexes and empty chunk sets as script parse errors', () => {
  expect(() => parseSceneSplitBatch('{"scenes":[{"sceneIndex":0,"chunks":[]}]}'))
    .toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
});
```

Because `sceneIndex: 0` and `chunks: []` are both invalid at the same time, this only proves "at least one of these causes rejection" — it wouldn't catch a bug where `sceneIndex` validation silently accepted 0, since the empty `chunks` array would still make the whole parse fail and the test would still pass. Split it into two separate test cases, each isolating one invalid field with the other field otherwise valid:

```ts
it('rejects a non-positive sceneIndex as a script parse error', () => {
  expect(() => parseSceneSplitBatch('{"scenes":[{"sceneIndex":0,"chunks":["Valid chunk"]}]}'))
    .toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
});

it('rejects an empty chunk set as a script parse error', () => {
  expect(() => parseSceneSplitBatch('{"scenes":[{"sceneIndex":1,"chunks":[]}]}'))
    .toThrow(expect.objectContaining({ code: 'SCRIPT_PARSE_ERROR' }));
});
```

The "extra fields stripped rather than rejected" observation needs no fix — `VisualPromptBatchSchema`, the sibling schema this was intentionally modeled on, has the same non-strict behavior, so `SceneSplitBatchSchema` is consistent with existing convention here.

Please make just that test split, re-run `npx vitest run src/server/modules/script/scene-split.test.ts`, commit it (e.g. `test(script): isolate scene split schema validation cases`), and then proceed to Task 2.
