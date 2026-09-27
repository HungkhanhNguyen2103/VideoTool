import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { RemotionInputPropsSchema, type RemotionInputProps } from '../src/contracts/video';
import { getCollection, connectDb, closeDb } from '../src/server/db/client';
import { loadConfig } from '../src/server/config';
import { ProjectDocSchema, type ProjectDoc } from '../src/server/modules/project/docs';
import { createFileStoreService } from '../src/server/modules/file-store/service';

const config = loadConfig();
const outputDir = path.resolve('data/files/.verification/task-43a');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'video-tool-task-43a-'));
const publicDir = path.join(temporaryRoot, 'public');
const bundleDir = path.join(temporaryRoot, 'bundle');

async function findKodak(): Promise<ProjectDoc> {
  const raw = await getCollection<ProjectDoc>('projects').find({ title: { $regex: 'Kodak', $options: 'i' } }).sort({ updatedAt: -1 }).limit(1).next();
  if (!raw) throw new Error('No Kodak project found in MongoDB.');
  return ProjectDocSchema.parse(raw);
}

function makeProps(assetA: string, assetB: string, filmLook: boolean, keywords: RemotionInputProps['scenes'][number]['keywords'] = [], durationSec = 5): RemotionInputProps {
  return RemotionInputPropsSchema.parse({
    fps: 30,
    width: 1920,
    height: 1080,
    bgmRelPath: null,
    transitionStyle: 'crossfade',
    scenes: [{ id: 'film-look-scene', assetType: 'image', assetRelPath: assetA, voiceRelPath: null, sfxRelPath: null, durationSec, filmLook, keywords }],
  });
}

function makeSegment(assetA: string, assetB: string, filmLook: boolean): RemotionInputProps {
  return RemotionInputPropsSchema.parse({
    fps: 30,
    width: 1920,
    height: 1080,
    bgmRelPath: null,
    transitionStyle: 'crossfade',
    scenes: Array.from({ length: 6 }, (_, index) => ({
      id: `film-segment-${index + 1}`,
      assetType: 'image',
      assetRelPath: index % 2 === 0 ? assetA : assetB,
      voiceRelPath: null,
      sfxRelPath: null,
      durationSec: 4,
      filmLook,
      keywords: [],
    })),
  });
}

async function renderStillAt(serveUrl: string, props: RemotionInputProps, output: string, frame: number): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props });
  await renderStill({ serveUrl, composition, inputProps: props, output, frame, imageFormat: 'png' });
}

async function renderTimedClip(serveUrl: string, props: RemotionInputProps, output: string): Promise<number> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props });
  const started = performance.now();
  await renderMedia({ serveUrl, composition, inputProps: props, codec: 'h264', outputLocation: output });
  return performance.now() - started;
}

await mkdir(outputDir, { recursive: true });
await connectDb(config.MONGODB_URI, config.MONGODB_DB);
try {
  const project = await findKodak();
  const imageScenes = project.scenes.filter((scene) => scene.assetType === 'image' && scene.assetFileId);
  if (imageScenes.length < 2) throw new Error('Kodak project needs two image scene assets.');
  const resolver = createFileStoreService(config.FILES_DIR);
  const assets = await Promise.all(imageScenes.slice(0, 2).map((scene) => resolver.resolveFilePath(project._id, scene.assetFileId!)));
  const extensionA = path.extname(assets[0]!.absolutePath).toLowerCase() || '.png';
  const extensionB = path.extname(assets[1]!.absolutePath).toLowerCase() || '.png';
  const publicAssetDir = path.join(publicDir, 'renders/task-43a');
  await mkdir(publicAssetDir, { recursive: true });
  await mkdir(path.join(publicDir, 'fonts'), { recursive: true });
  await Promise.all([
    copyFile(assets[0]!.absolutePath, path.join(publicAssetDir, `kodak-a${extensionA}`)),
    copyFile(assets[1]!.absolutePath, path.join(publicAssetDir, `kodak-b${extensionB}`)),
    copyFile('src/remotion/fonts/NotoSans-vietnamese.woff2', path.join(publicDir, 'fonts/NotoSans-vietnamese.woff2')),
    copyFile('src/remotion/fonts/NotoSans-latin.woff2', path.join(publicDir, 'fonts/NotoSans-latin.woff2')),
  ]);
  const serveUrl = await bundle({ entryPoint: path.resolve('src/remotion/index.ts'), outDir: bundleDir, publicDir, rootDir: process.cwd() });
  const assetA = `renders/task-43a/kodak-a${extensionA}`;
  const assetB = `renders/task-43a/kodak-b${extensionB}`;

  await renderStillAt(serveUrl, makeProps(assetA, assetB, false), path.join(outputDir, 'film-off-full.png'), 45);
  await renderStillAt(serveUrl, makeProps(assetA, assetB, true), path.join(outputDir, 'film-on-full.png'), 45);
  await renderStillAt(serveUrl, makeProps(assetA, assetB, true), path.join(outputDir, 'film-on-grain-frame-45.png'), 45);
  await renderStillAt(serveUrl, makeProps(assetA, assetB, true), path.join(outputDir, 'film-on-grain-frame-46.png'), 46);
  await renderStillAt(serveUrl, makeProps(assetA, assetB, true), path.join(outputDir, 'film-on-grain-frame-47.png'), 47);
  await renderStillAt(serveUrl, makeProps(assetA, assetB, true, [{ text: 'Steven Sasson', startSec: .5, endSec: 4, kind: 'name', nameRole: 'person', subtitle: 'Kỹ sư' }]), path.join(outputDir, 'film-on-lower-third.png'), 60);

  const offMs = await renderTimedClip(serveUrl, makeSegment(assetA, assetB, false), path.join(outputDir, 'segment-off.mp4'));
  const onMs = await renderTimedClip(serveUrl, makeSegment(assetA, assetB, true), path.join(outputDir, 'segment-on.mp4'));
  const timing = { durationSec: 24, offMs: Math.round(offMs), onMs: Math.round(onMs), percentDifference: Number(((onMs - offMs) / offMs * 100).toFixed(1)), projectId: project._id, sceneIds: imageScenes.slice(0, 2).map((scene) => scene.id) };
  await writeFile(path.join(outputDir, 'timings.json'), JSON.stringify(timing, null, 2));
  console.log(JSON.stringify({ outputDir, ...timing }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  await closeDb();
}
