import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';

let remotionPublicDir = './data/remotion-public';
let cachedBundle: Promise<string> | null = null;
let bundleImplementation: typeof bundle = bundle;

export function configureRemotionBundle(directory: string, implementation: typeof bundle = bundle): void {
  if (directory === remotionPublicDir && cachedBundle && implementation === bundleImplementation) return;
  remotionPublicDir = directory;
  bundleImplementation = implementation;
  cachedBundle = null;
}

export function getRemotionBundle(): Promise<string> {
  if (!cachedBundle) {
    const outputDir = path.resolve(remotionPublicDir);
    const seedPublicDir = path.join(outputDir, '.seed-public');
    cachedBundle = mkdir(path.join(seedPublicDir, 'fonts'), { recursive: true })
      .then(() => Promise.all([
        copyFile(path.resolve('src/remotion/fonts/NotoSans-vietnamese.woff2'), path.join(seedPublicDir, 'fonts/NotoSans-vietnamese.woff2')),
        copyFile(path.resolve('src/remotion/fonts/NotoSans-latin.woff2'), path.join(seedPublicDir, 'fonts/NotoSans-latin.woff2')),
        copyFile(path.resolve('src/remotion/fonts/NotoSans-OFL.txt'), path.join(seedPublicDir, 'fonts/NotoSans-OFL.txt')),
      ]))
      .then(() => bundleImplementation({
        entryPoint: path.resolve(process.cwd(), 'src/remotion/index.ts'),
        outDir: outputDir,
        publicDir: seedPublicDir,
        rootDir: process.cwd(),
      }))
      .then((serveUrl) => path.resolve(serveUrl))
      .catch((error) => {
        cachedBundle = null;
        throw error;
      });
  }
  return cachedBundle;
}

export function resetRemotionBundleCache(): void {
  cachedBundle = null;
}
