import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { RemotionInputPropsSchema, type RemotionInputProps } from '../src/contracts/video';
import { getCollection, connectDb, closeDb } from '../src/server/db/client';
import { loadConfig } from '../src/server/config';
import { ProjectDocSchema, type ProjectDoc } from '../src/server/modules/project/docs';
import { createFileStoreService } from '../src/server/modules/file-store/service';

const config = loadConfig();
const outputDir = path.resolve('data/files/.verification/task-40');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'video-tool-task-40-'));
const publicDir = path.join(temporaryRoot, 'public');
const bundleDir = path.join(temporaryRoot, 'bundle');

async function findKodak(): Promise<ProjectDoc> {
  const raw = await getCollection<ProjectDoc>('projects').find({ title: { $regex: 'Kodak', $options: 'i' } }).sort({ updatedAt: -1 }).limit(1).next();
  if (!raw) throw new Error('No Kodak project found in MongoDB.');
  return ProjectDocSchema.parse(raw);
}

function sceneProps(assetRelPath: string, keyword: RemotionInputProps['scenes'][number]['keywords'][number]): RemotionInputProps {
  return RemotionInputPropsSchema.parse({
    fps: 30,
    width: 1920,
    height: 1080,
    bgmRelPath: null,
    scenes: [{ id: 'verification-scene', assetType: 'image', assetRelPath, voiceRelPath: null, sfxRelPath: null, durationSec: 2.1, keywords: [keyword] }],
  });
}

async function renderProofs(id: 'count' | 'year', props: RemotionInputProps): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props });
  const frames = [3, 14, 29];
  for (const [index, frame] of frames.entries()) {
    await renderStill({ serveUrl, composition, inputProps: props, output: path.join(outputDir, `${id}-${['start', 'mid', 'final'][index]}.png`), frame, imageFormat: 'png' });
  }
  await renderMedia({
    serveUrl,
    composition,
    inputProps: props,
    codec: 'h264',
    outputLocation: path.join(outputDir, `${id}-2s.mp4`),
  });
}

await mkdir(outputDir, { recursive: true });
await connectDb(config.MONGODB_URI, config.MONGODB_DB);
let serveUrl = '';
try {
  const project = await findKodak();
  const scene = project.scenes.find((candidate) => candidate.assetFileId && candidate.wordTimings?.words.some((word) => /30/.test(word.text))) ?? project.scenes.find((candidate) => candidate.assetFileId);
  if (!scene?.assetFileId) throw new Error('Kodak project has no scene visual asset.');
  const resolver = createFileStoreService(config.FILES_DIR);
  const asset = await resolver.resolveFilePath(project._id, scene.assetFileId);
  const assetRelPath = 'renders/task-40/kodak-asset.jpg';
  await mkdir(path.join(publicDir, 'renders/task-40'), { recursive: true });
  await mkdir(path.join(publicDir, 'fonts'), { recursive: true });
  await Promise.all([
    copyFile(asset.absolutePath, path.join(publicDir, assetRelPath)),
    copyFile('src/remotion/fonts/NotoSans-vietnamese.woff2', path.join(publicDir, 'fonts/NotoSans-vietnamese.woff2')),
    copyFile('src/remotion/fonts/NotoSans-latin.woff2', path.join(publicDir, 'fonts/NotoSans-latin.woff2')),
  ]);
  serveUrl = await bundle({ entryPoint: path.resolve('src/remotion/index.ts'), outDir: bundleDir, publicDir, rootDir: process.cwd() });

  await renderProofs('count', sceneProps(assetRelPath, {
    text: '30 tỷ đô la', startSec: .1, endSec: 2, kind: 'number', value: 30, decimals: 0, grouping: false, prefix: '', suffix: 'tỷ đô la',
  }));
  await renderProofs('year', sceneProps(assetRelPath, {
    text: '1975', startSec: .1, endSec: 2, kind: 'year', year: 1975, fromYear: 1965, timeline: { min: 1960, max: 1980 },
  }));
  console.log(JSON.stringify({ outputDir, projectId: project._id, sceneId: scene.id, serveUrl }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  await closeDb();
}
