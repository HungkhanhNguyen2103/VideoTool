import { mkdir } from 'node:fs/promises';
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
    cachedBundle = mkdir(seedPublicDir, { recursive: true })
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
