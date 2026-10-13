import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'src/server/modules/script/ai/presets');
const seoSource = join(root, 'src/server/modules/seo/ai/presets');
const popupSource = join(root, 'src/server/modules/video/ai/presets');
const destination = join(root, 'dist/presets');

await mkdir(destination, { recursive: true });
const names = (await readdir(source)).filter((name) => name.endsWith('.md')).sort();
for (const name of names) {
  await cp(join(source, name), join(destination, name));
}
const seoNames = (await readdir(seoSource)).filter((name) => name.endsWith('.md')).sort();
for (const name of seoNames) {
  await cp(join(seoSource, name), join(destination, name));
}
const popupNames = (await readdir(popupSource)).filter((name) => name.endsWith('.md')).sort();
for (const name of popupNames) {
  await cp(join(popupSource, name), join(destination, name));
}

async function copyMarkdownTree(sourceDirectory, destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = join(sourceDirectory, entry.name);
    const destinationPath = join(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyMarkdownTree(sourcePath, destinationPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      await cp(sourcePath, destinationPath);
    }
  }
}

await copyMarkdownTree(join(source, 'visual-styles'), join(destination, 'visual-styles'));
