import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const outputDir = path.resolve('data/files/.verification/task-37/automated-font-check');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'video-tool-keyword-font-'));
const bundleDir = path.join(temporaryRoot, 'bundle');
const publicDir = path.join(temporaryRoot, 'public');

function md5(value: Buffer): string {
  return createHash('md5').update(value).digest('hex');
}

try {
  await mkdir(path.join(publicDir, 'fonts'), { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    copyFile(path.resolve('src/remotion/fonts/NotoSans-vietnamese.woff2'), path.join(publicDir, 'fonts/NotoSans-vietnamese.woff2')),
    copyFile(path.resolve('src/remotion/fonts/NotoSans-latin.woff2'), path.join(publicDir, 'fonts/NotoSans-latin.woff2')),
  ]);

  const serveUrl = await bundle({
    entryPoint: path.resolve('scripts/remotion-font-verification/index.tsx'),
    outDir: bundleDir,
    publicDir,
    rootDir: process.cwd(),
  });

  const realPath = path.join(outputDir, 'real.png');
  const bogusPath = path.join(outputDir, 'bogus.png');
  for (const [id, output] of [['KeywordFontReal', realPath], ['KeywordFontBogus', bogusPath]] as const) {
    const composition = await selectComposition({ serveUrl, id });
    await renderStill({ serveUrl, composition, output, frame: 0, imageFormat: 'png' });
  }

  const [realBytes, bogusBytes] = await Promise.all([readFile(realPath), readFile(bogusPath)]);
  const result = {
    real: { path: realPath, md5: md5(realBytes) },
    bogus: { path: bogusPath, md5: md5(bogusBytes) },
  };
  console.log(JSON.stringify(result, null, 2));
  if (realBytes.equals(bogusBytes)) throw new Error('Keyword font verification failed: real and bogus-family renders are byte-identical.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
