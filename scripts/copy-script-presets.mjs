import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'src/server/modules/script/ai/presets');
const destination = join(root, 'dist/presets');

await mkdir(destination, { recursive: true });
for (const name of ['documentary.md', 'explainer.md']) {
  await cp(join(source, name), join(destination, name));
}
