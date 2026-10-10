import { readFile, readdir, writeFile } from 'node:fs/promises';

if (process.argv.includes('--version')) {
  process.stdout.write('Claude Code 2.1.294\n');
  process.exit(0);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString('utf8');
if (process.env.FAKE_CLAUDE_CAPTURE) await writeFile(process.env.FAKE_CLAUDE_CAPTURE, prompt);
if (process.env.FAKE_CLAUDE_CWD_CAPTURE) await writeFile(process.env.FAKE_CLAUDE_CWD_CAPTURE, JSON.stringify(await readdir(process.cwd())));

switch (process.env.FAKE_CLAUDE_MODE) {
  case 'fenced':
    process.stdout.write('```json\n{"paragraphs":["A"],"chapterSummary":"S","avoidRepeating":[],"persistentFactsNext":[]}\n```');
    break;
  case 'hang':
    if (process.env.FAKE_CLAUDE_STARTED) await writeFile(process.env.FAKE_CLAUDE_STARTED, 'started');
    setInterval(() => undefined, 1_000);
    break;
  case 'oversized':
    process.stdout.write('x'.repeat(100_000));
    break;
  case 'rate-limit':
    process.stderr.write('429 rate limit exceeded');
    process.exitCode = 1;
    break;
  case 'auth-failed':
    process.stderr.write('Authentication required. Please run /login.');
    process.exitCode = 1;
    break;
  case 'sequence': {
    const responses = JSON.parse(await readFile(process.env.FAKE_CLAUDE_RESPONSES, 'utf8'));
    const indexPath = process.env.FAKE_CLAUDE_INDEX;
    let index = 0;
    try { index = Number(await readFile(indexPath, 'utf8')) || 0; } catch { /* first invocation */ }
    await writeFile(indexPath, String(index + 1));
    process.stdout.write(String(responses[index] ?? ''));
    break;
  }
  case 'garbage':
    process.stdout.write('not JSON');
    break;
  case 'valid':
  default:
    process.stdout.write('{"paragraphs":["A response."],"chapterSummary":"Summary","avoidRepeating":[],"persistentFactsNext":[]}');
}
