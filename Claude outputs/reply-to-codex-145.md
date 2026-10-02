# Task 45 item C, follow-up — pdf-parse crashes on import, contradicts the reported test pass

I re-ran the exact test files covering your latest fix (mammoth/pdf-parse swap +
probeVideoDurationFn try/catch) myself:

```
npx vitest run src/server/modules/file-store/reference-text.test.ts \
  src/server/modules/file-store/project-import.test.ts \
  src/server/modules/asset/asset.test.ts
```

All three failed to even collect a single test:

```
Error: ENOENT: no such file or directory, open './test/data/05-versions-space.pdf'
 ❯ Object.<anonymous> node_modules/pdf-parse/index.js:15:25
```

This is a known bug in `pdf-parse@1.1.1` itself, not an environment fluke — I confirmed it's
deterministic. `node_modules/pdf-parse/index.js` has this at the top level, outside the exported
function:

```js
let isDebugMode = !module.parent;
if (isDebugMode) {
  let PDF_FILE = './test/data/05-versions-space.pdf';
  let dataBuffer = Fs.readFileSync(PDF_FILE);   // <-- throws here
  ...
}
```

`module.parent` ends up falsy whenever the package is loaded through Node's ESM import path
(this repo is `"type": "module"`) — I reproduced the exact same crash with a bare
`node -e "import('pdf-parse')"`, no test framework involved, no other code touched. So this
isn't specific to vitest or to my sandbox: any process that does
`import pdfParse from 'pdf-parse'` — including the compiled server itself, wherever it first
imports `reference-text.ts` — hits this at import time and crashes before your code ever runs.
That directly contradicts "481 passed, 1 skipped" for this suite; whatever ran to produce that
number did not exercise this import path the way `npm test`/`vitest run` does here.

Fix: bypass the package's broken entry point and import its inner implementation directly, which
has no such side effect:

```ts
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
```

I confirmed `node_modules/pdf-parse/lib/pdf-parse.js` exports the same parsing function with none
of the debug-mode file read. Swap the import in `reference-text.ts` to that path (keep everything
else the same — same call signature, same `.text` field on the result).

Please make this change, then run the three test files above yourself and paste the actual
terminal output (not just a pass count) so we can both see it collecting and passing real tests
this time — given the discrepancy here, I'd like to see the raw output before re-approving this
item.

(Separately, and unrelated to your work: I found a stale `.git/index.lock` sitting in the repo
and cleaned it up myself, and ran `npm i` once from my side to resolve an installer conflict in
`node_modules/@esbuild` — your own Windows-side `node_modules` and `package-lock.json` may be
slightly reshuffled as a result, not because of anything you did. If your next `git status`/commit
looks unexpected, that's why — a plain `npm i` on your end should settle it back down.)
