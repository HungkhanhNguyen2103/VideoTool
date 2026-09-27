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
const outputDir = path.resolve('data/files/.verification/task-43c');
const calibrationDir = path.resolve('data/files/.verification/task-43c/calibration');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'video-tool-task-43c-'));
const publicDir = path.join(temporaryRoot, 'public');
const bundleDir = path.join(temporaryRoot, 'bundle');
const chromiumOptions = { gl: 'angle' as const };

async function findKodak(): Promise<ProjectDoc> {
  const raw = await getCollection<ProjectDoc>('projects').find({ title: { $regex: 'Kodak', $options: 'i' } }).sort({ updatedAt: -1 }).limit(1).next();
  if (!raw) throw new Error('No Kodak project found in MongoDB.');
  return ProjectDocSchema.parse(raw);
}

function makeProps(assetA: string, depthA: string, assetB: string, depthB: string, options: { width?: number; height?: number; parallax?: 'auto' | 'off'; filmLook?: boolean; twoScenes?: boolean; keyword?: boolean } = {}): RemotionInputProps {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const scene = (id: string, assetRelPath: string, depthMapRelPath: string, filmLook: boolean) => ({
    id, assetType: 'image' as const, assetRelPath, depthMapRelPath: options.parallax === 'auto' ? depthMapRelPath : null,
    voiceRelPath: null, sfxRelPath: null, durationSec: 4, filmLook,
    keywords: options.keyword && id === 'lab' ? [{ text: 'Steven Sasson', kind: 'name' as const, nameRole: 'person' as const, subtitle: 'Kỹ sư', startSec: .4, endSec: 3.5 }] : [],
  });
  const scenes = options.twoScenes
    ? [scene('boardroom', assetA, depthA, Boolean(options.filmLook)), scene('lab', assetB, depthB, Boolean(options.filmLook))]
    : [scene('lab', assetB, depthB, Boolean(options.filmLook))];
  return RemotionInputPropsSchema.parse({ fps: 30, width, height, scenes, bgmRelPath: null, transitionStyle: 'crossfade', parallax: options.parallax ?? 'off' });
}

async function renderStillAt(serveUrl: string, props: RemotionInputProps, output: string, frame: number): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props, chromiumOptions });
  await renderStill({ serveUrl, composition, inputProps: props, output, frame, imageFormat: 'png', chromiumOptions });
}

async function renderTimedClip(serveUrl: string, props: RemotionInputProps, output: string): Promise<number> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props, chromiumOptions });
  const started = performance.now();
  await renderMedia({ serveUrl, composition, inputProps: props, codec: 'h264', outputLocation: output, chromiumOptions, concurrency: 1 });
  return performance.now() - started;
}

await mkdir(outputDir, { recursive: true });
await connectDb(config.MONGODB_URI, config.MONGODB_DB);
try {
  const project = await findKodak();
  const scenes = project.scenes.filter((scene) => scene.assetType === 'image' && scene.assetFileId);
  if (scenes.length < 2) throw new Error('Kodak project needs two image scenes.');
  const resolver = createFileStoreService(config.FILES_DIR);
  const boardroom = scenes[0]!;
  const lab = scenes[1]!;
  const [boardroomFile, labFile] = await Promise.all([resolver.resolveFilePath(project._id, boardroom.assetFileId!), resolver.resolveFilePath(project._id, lab.assetFileId!)]);
  const boardroomExt = path.extname(boardroomFile.absolutePath).toLowerCase() || '.png';
  const labExt = path.extname(labFile.absolutePath).toLowerCase() || '.png';
  const assetDir = path.join(publicDir, 'renders/task-43c');
  await mkdir(assetDir, { recursive: true });
  await mkdir(path.join(publicDir, 'fonts'), { recursive: true });
  await Promise.all([
    copyFile(boardroomFile.absolutePath, path.join(assetDir, `boardroom${boardroomExt}`)),
    copyFile(labFile.absolutePath, path.join(assetDir, `lab${labExt}`)),
    copyFile(path.join(calibrationDir, 'depth', `01-${boardroom.id}.png`), path.join(assetDir, 'boardroom-depth.png')),
    copyFile(path.join(calibrationDir, 'depth', `02-${lab.id}.png`), path.join(assetDir, 'lab-depth.png')),
    copyFile('src/remotion/fonts/NotoSans-vietnamese.woff2', path.join(publicDir, 'fonts/NotoSans-vietnamese.woff2')),
    copyFile('src/remotion/fonts/NotoSans-latin.woff2', path.join(publicDir, 'fonts/NotoSans-latin.woff2')),
  ]);
  const serveUrl = await bundle({ entryPoint: path.resolve('src/remotion/index.ts'), outDir: bundleDir, publicDir, rootDir: process.cwd() });
  const boardroomAsset = `renders/task-43c/boardroom${boardroomExt}`;
  const labAsset = `renders/task-43c/lab${labExt}`;
  const boardroomDepth = 'renders/task-43c/boardroom-depth.png';
  const labDepth = 'renders/task-43c/lab-depth.png';

  const labProps = makeProps(boardroomAsset, boardroomDepth, labAsset, labDepth, { parallax: 'auto' });
  const boardProps = RemotionInputPropsSchema.parse({ ...makeProps(boardroomAsset, boardroomDepth, labAsset, labDepth, { parallax: 'auto' }), scenes: [{ ...makeProps(boardroomAsset, boardroomDepth, labAsset, labDepth, { parallax: 'auto' }).scenes[0]!, id: 'boardroom', assetRelPath: boardroomAsset, depthMapRelPath: boardroomDepth }] });
  for (const [name, props] of [['lab', labProps], ['boardroom', boardProps]] as const) {
    await renderStillAt(serveUrl, props, path.join(outputDir, `${name}-0.png`), 0);
    await renderStillAt(serveUrl, props, path.join(outputDir, `${name}-50.png`), 60);
    await renderStillAt(serveUrl, props, path.join(outputDir, `${name}-100.png`), 119);
  }
  await renderStillAt(serveUrl, makeProps(boardroomAsset, boardroomDepth, labAsset, labDepth, { parallax: 'auto', filmLook: true, keyword: true }), path.join(outputDir, 'film-look-parallax.png'), 45);
  const transitionProps = makeProps(boardroomAsset, boardroomDepth, labAsset, labDepth, { parallax: 'auto', twoScenes: true });
  await renderStillAt(serveUrl, transitionProps, path.join(outputDir, 'transition-mid-parallax.png'), 127);
  const verticalProps = makeProps(boardroomAsset, boardroomDepth, labAsset, labDepth, { width: 1080, height: 1920, parallax: 'auto' });
  await renderStillAt(serveUrl, verticalProps, path.join(outputDir, 'parallax-9x16.png'), 45);

  const segment = (parallax: 'auto' | 'off', filmLook: boolean) => {
    const scene = (index: number) => ({ id: `segment-${index + 1}`, assetType: 'image' as const, assetRelPath: index % 2 === 0 ? boardroomAsset : labAsset, depthMapRelPath: parallax === 'auto' ? (index % 2 === 0 ? boardroomDepth : labDepth) : null, voiceRelPath: null, sfxRelPath: null, durationSec: 4, filmLook, keywords: [] });
    return RemotionInputPropsSchema.parse({ fps: 30, width: 1920, height: 1080, scenes: Array.from({ length: 6 }, (_, index) => scene(index)), bgmRelPath: null, transitionStyle: 'crossfade', parallax });
  };
  const timings: Record<string, number> = {};
  for (const [name, parallax, filmLook] of [['off-film-off', 'off', false], ['on-film-off', 'auto', false], ['off-film-on', 'off', true], ['on-film-on', 'auto', true] as const]) {
    timings[name] = Math.round(await renderTimedClip(serveUrl, segment(parallax, filmLook), path.join(outputDir, `${name}.mp4`)));
  }
  await writeFile(path.join(outputDir, 'timings.json'), JSON.stringify({ projectId: project._id, width: 1920, height: 1080, fps: 30, durationSec: 24, chromiumOptions, timings }, null, 2));
  console.log(JSON.stringify({ outputDir, timings, projectId: project._id }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  await closeDb();
}
