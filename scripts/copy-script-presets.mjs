import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'src/server/modules/script/ai/presets');
const destination = join(root, 'dist/presets');

await mkdir(destination, { recursive: true });
const names = (await readdir(source)).filter((name) => name.endsWith('.md')).sort();
for (const name of names) {
  await cp(join(source, name), join(destination, name));
}
