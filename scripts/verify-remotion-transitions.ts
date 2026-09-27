import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { RemotionInputPropsSchema, type RemotionInputProps } from '../src/contracts/video';
import { planTransitions, type TransitionType } from '../src/remotion/frame-math';
import { getCollection, connectDb, closeDb } from '../src/server/db/client';
import { loadConfig } from '../src/server/config';
import { ProjectDocSchema, type ProjectDoc } from '../src/server/modules/project/docs';
import { createFileStoreService } from '../src/server/modules/file-store/service';

const config = loadConfig();
const outputDir = path.resolve('data/files/.verification/task-42');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'video-tool-task-42-'));
const publicDir = path.join(temporaryRoot, 'public');
const bundleDir = path.join(temporaryRoot, 'bundle');
const transitionTypes: TransitionType[] = ['crossfade', 'wipe', 'whipPan', 'zoomThrough', 'lightLeak', 'filmBurn'];

async function findKodak(): Promise<ProjectDoc> {
  const raw = await getCollection<ProjectDoc>('projects').find({ title: { $regex: 'Kodak', $options: 'i' } }).sort({ updatedAt: -1 }).limit(1).next();
  if (!raw) throw new Error('No Kodak project found in MongoDB.');
  return ProjectDocSchema.parse(raw);
}

function makeProps(assetA: string, assetB: string, ids: string[], durationSec = 5): RemotionInputProps {
  return RemotionInputPropsSchema.parse({
    fps: 30,
    width: 1920,
    height: 1080,
    bgmRelPath: null,
    transitionStyle: 'varied',
    scenes: ids.map((id, index) => ({
      id,
      assetType: 'image',
      assetRelPath: index % 2 === 0 ? assetA : assetB,
      voiceRelPath: null,
      sfxRelPath: null,
      durationSec,
      keywords: [],
    })),
  });
}

function findIncomingId(previousId: string, target: TransitionType, prefix: string, existing: string[] = []): string {
  for (let index = 0; index < 100_000; index += 1) {
    const candidate = `${prefix}-${index}`;
    const plans = planTransitions([
      ...existing.map((id) => ({ id, assetType: 'image' as const, durationSec: 5 })),
      { id: previousId, assetType: 'image' as const, durationSec: 5 },
      { id: candidate, assetType: 'image' as const, durationSec: 5 },
    ], 30, 'varied');
    if (plans.at(-1)?.type === target) return candidate;
  }
  throw new Error(`Unable to find deterministic id for transition ${target}.`);
}

async function renderStillAt(serveUrl: string, props: RemotionInputProps, output: string, frame: number): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props });
  await renderStill({ serveUrl, composition, inputProps: props, output, frame, imageFormat: 'png' });
}

async function renderClip(serveUrl: string, props: RemotionInputProps, output: string): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props });
  await renderMedia({ serveUrl, composition, inputProps: props, codec: 'h264', outputLocation: output });
}

await mkdir(outputDir, { recursive: true });
await connectDb(config.MONGODB_URI, config.MONGODB_DB);
try {
  const project = await findKodak();
  const imageScenes = project.scenes.filter((scene) => scene.assetType === 'image' && scene.assetFileId);
  if (imageScenes.length === 0) throw new Error('Kodak project has no image scene assets.');
  const resolver = createFileStoreService(config.FILES_DIR);
  const assets = await Promise.all(imageScenes.slice(0, 2).map(async (scene) => resolver.resolveFilePath(project._id, scene.assetFileId!)));
  const assetPaths = assets.length === 1 ? [assets[0]!.absolutePath, assets[0]!.absolutePath] : assets.map((asset) => asset.absolutePath);
  const publicAssetDir = path.join(publicDir, 'renders/task-42');
  await mkdir(publicAssetDir, { recursive: true });
  await mkdir(path.join(publicDir, 'fonts'), { recursive: true });
  const extensionA = path.extname(assetPaths[0]!).toLowerCase() || '.jpg';
  const extensionB = path.extname(assetPaths[1]!).toLowerCase() || '.jpg';
  await Promise.all([
    copyFile(assetPaths[0]!, path.join(publicAssetDir, `kodak-a${extensionA}`)),
    copyFile(assetPaths[1]!, path.join(publicAssetDir, `kodak-b${extensionB}`)),
    copyFile('src/remotion/fonts/NotoSans-vietnamese.woff2', path.join(publicDir, 'fonts/NotoSans-vietnamese.woff2')),
    copyFile('src/remotion/fonts/NotoSans-latin.woff2', path.join(publicDir, 'fonts/NotoSans-latin.woff2')),
  ]);
  const serveUrl = await bundle({ entryPoint: path.resolve('src/remotion/index.ts'), outDir: bundleDir, publicDir, rootDir: process.cwd() });
  const assetA = `renders/task-42/kodak-a${extensionA}`;
  const assetB = `renders/task-42/kodak-b${extensionB}`;
  const boundaryFrames = 150;

  for (const type of transitionTypes) {
    const incomingId = findIncomingId(`out-${type}`, type, `incoming-${type}`);
    const props = makeProps(assetA, assetB, [`out-${type}`, incomingId]);
    const frames = planTransitions(props.scenes, props.fps, props.transitionStyle)[0]!.frames;
    for (const percentage of [25, 50, 75]) {
      const frame = boundaryFrames + Math.round(frames * percentage / 100);
      await renderStillAt(serveUrl, props, path.join(outputDir, `${type}-${percentage}.png`), frame);
    }
  }

  const ids = ['clip-start'];
  for (const type of transitionTypes) ids.push(findIncomingId(ids.at(-1)!, type, `clip-${type}`, ids.slice(0, -1)));
  await renderClip(serveUrl, makeProps(assetA, assetB, ids, 2.5), path.join(outputDir, 'all-transitions.mp4'));

  console.log(JSON.stringify({ outputDir, projectId: project._id, sceneIds: imageScenes.slice(0, 2).map((scene) => scene.id), types: transitionTypes, ids }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  await closeDb();
}
