import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { RemotionInputPropsSchema, type RemotionInputProps } from '../src/contracts/video';

const outputDir = path.resolve('data/files/.verification/task-67');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'video-tool-task-67-'));
const publicDir = path.join(temporaryRoot, 'public');
const bundleDir = path.join(temporaryRoot, 'bundle');

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  return Buffer.concat([length, name, data, checksum]);
}

function makePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      const [red, green, blue, alpha] = pixel(x, y);
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function props(width: number, height: number, sceneA: string, sceneB: string, logo: string): RemotionInputProps {
  return RemotionInputPropsSchema.parse({
    fps: 30,
    width,
    height,
    bgmRelPath: null,
    logoRelPath: logo,
    transitionStyle: 'crossfade',
    scenes: [sceneA, sceneB].map((assetRelPath, index) => ({
      id: `logo-scene-${index + 1}`,
      assetType: 'image',
      assetRelPath,
      voiceRelPath: null,
      sfxRelPath: null,
      durationSec: 1,
      filmLook: true,
      keywords: [],
    })),
  });
}

async function renderAspect(name: string, width: number, height: number, sceneA: string, sceneB: string, logo: string, serveUrl: string): Promise<Record<string, string | number>> {
  const inputProps = props(width, height, sceneA, sceneB, logo);
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps });
  const video = path.join(outputDir, `${name}.mp4`);
  const boundaryBefore = path.join(outputDir, `${name}-before-boundary.png`);
  const boundaryAfter = path.join(outputDir, `${name}-after-boundary.png`);
  const started = performance.now();
  await renderMedia({ serveUrl, composition, inputProps, codec: 'h264', outputLocation: video });
  await renderStill({ serveUrl, composition, inputProps, output: boundaryBefore, frame: 29, imageFormat: 'png' });
  await renderStill({ serveUrl, composition, inputProps, output: boundaryAfter, frame: 31, imageFormat: 'png' });
  return { video, boundaryBefore, boundaryAfter, renderMs: Math.round(performance.now() - started) };
}

await mkdir(outputDir, { recursive: true });
try {
  const assetDir = path.join(publicDir, 'renders', 'task-67');
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, 'scene-a.png'), makePng(320, 180, () => [34, 64, 110, 255]));
  await writeFile(path.join(assetDir, 'scene-b.png'), makePng(320, 180, () => [116, 50, 42, 255]));
  await writeFile(path.join(assetDir, 'scene-a-vertical.png'), makePng(180, 320, () => [34, 64, 110, 255]));
  await writeFile(path.join(assetDir, 'scene-b-vertical.png'), makePng(180, 320, () => [116, 50, 42, 255]));
  const logoBuffer = makePng(64, 32, (x, y) => {
    const inMark = x >= 4 && x < 60 && y >= 5 && y < 27;
    const inStripe = (x + y) % 12 < 5 && inMark;
    return inMark ? [inStripe ? 255 : 245, inStripe ? 194 : 119, 42, 235] : [0, 0, 0, 0];
  });
  await writeFile(path.join(assetDir, 'logo.png'), logoBuffer);
  await writeFile(path.join(outputDir, 'logo-fixture.png'), logoBuffer);
  const serveUrl = await bundle({ entryPoint: path.resolve('src/remotion/index.ts'), outDir: bundleDir, publicDir, rootDir: process.cwd() });
  const results = {
    outputDir,
    landscape: await renderAspect('landscape-16x9', 320, 180, 'renders/task-67/scene-a.png', 'renders/task-67/scene-b.png', 'renders/task-67/logo.png', serveUrl),
    portrait: await renderAspect('portrait-9x16', 180, 320, 'renders/task-67/scene-a-vertical.png', 'renders/task-67/scene-b-vertical.png', 'renders/task-67/logo.png', serveUrl),
  };
  console.log(JSON.stringify(results, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
