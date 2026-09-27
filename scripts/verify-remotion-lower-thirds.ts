import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const outputDir = path.resolve('data/files/.verification/task-41');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'video-tool-task-41-'));
const publicDir = path.join(temporaryRoot, 'public');
const bundleDir = path.join(temporaryRoot, 'bundle');

async function findKodak(): Promise<ProjectDoc> {
  const raw = await getCollection<ProjectDoc>('projects').find({ title: { $regex: 'Kodak', $options: 'i' } }).sort({ updatedAt: -1 }).limit(1).next();
  if (!raw) throw new Error('No Kodak project found in MongoDB.');
  return ProjectDocSchema.parse(raw);
}

function sceneProps(assetRelPath: string, keyword: RemotionInputProps['scenes'][number]['keywords'][number], width = 1920, height = 1080, durationSec = 4.2): RemotionInputProps {
  return RemotionInputPropsSchema.parse({
    fps: 30,
    width,
    height,
    bgmRelPath: null,
    scenes: [{ id: 'verification-scene', assetType: 'image', assetRelPath, voiceRelPath: null, sfxRelPath: null, durationSec, keywords: [keyword] }],
  });
}

async function still(serveUrl: string, props: RemotionInputProps, output: string, frame: number): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props });
  await renderStill({ serveUrl, composition, inputProps: props, output, frame, imageFormat: 'png' });
}

async function clip(serveUrl: string, props: RemotionInputProps, output: string, prefix: string): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: 'VideoComposition', inputProps: props });
  await renderMedia({ serveUrl, composition, inputProps: props, codec: 'h264', outputLocation: output });
  const durationInFrames = Math.max(1, Math.round(props.scenes[0]!.durationSec * props.fps));
  for (let index = 0; index < 6; index++) {
    const frame = Math.round(index * (durationInFrames - 1) / 5);
    await renderStill({
      serveUrl,
      composition,
      inputProps: props,
      output: path.join(outputDir, `${prefix}-frames-${String(index + 1).padStart(2, '0')}.png`),
      frame,
      imageFormat: 'png',
    });
  }
}

await mkdir(outputDir, { recursive: true });
await connectDb(config.MONGODB_URI, config.MONGODB_DB);
let serveUrl = '';
try {
  const project = await findKodak();
  const scene = project.scenes.find((candidate) => candidate.assetFileId);
  if (!scene?.assetFileId) throw new Error('Kodak project has no scene visual asset.');
  const resolver = createFileStoreService(config.FILES_DIR);
  const asset = await resolver.resolveFilePath(project._id, scene.assetFileId);
  const extension = path.extname(asset.absolutePath).toLowerCase() || '.jpg';
  const assetRelPath = `renders/task-41/kodak-asset${extension}`;
  await mkdir(path.join(publicDir, 'renders/task-41'), { recursive: true });
  await mkdir(path.join(publicDir, 'fonts'), { recursive: true });
  await Promise.all([
    copyFile(asset.absolutePath, path.join(publicDir, assetRelPath)),
    copyFile('src/remotion/fonts/NotoSans-vietnamese.woff2', path.join(publicDir, 'fonts/NotoSans-vietnamese.woff2')),
    copyFile('src/remotion/fonts/NotoSans-latin.woff2', path.join(publicDir, 'fonts/NotoSans-latin.woff2')),
    writeFile(path.join(publicDir, 'bright.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#f5f4ee"/></svg>'),
  ]);
  serveUrl = await bundle({ entryPoint: path.resolve('src/remotion/index.ts'), outDir: bundleDir, publicDir, rootDir: process.cwd() });

  const person = sceneProps(assetRelPath, { text: 'Steven Sasson', startSec: .4, endSec: 3.8, kind: 'name', nameRole: 'person', subtitle: 'Kỹ sư' });
  const place = sceneProps(assetRelPath, { text: 'Rochester', startSec: .4, endSec: 3.8, kind: 'name', nameRole: 'place' });
  const portrait = sceneProps(assetRelPath, { text: 'Steven Sasson', startSec: .4, endSec: 3.8, kind: 'name', nameRole: 'person', subtitle: 'Kỹ sư' }, 1080, 1920);
  const brightYear = sceneProps('bright.svg', { text: '1975', startSec: .2, endSec: 2.8, kind: 'year', year: 1975, fromYear: 1965, timeline: { min: 1960, max: 1980 } }, 1920, 1080, 3.1);

  await still(serveUrl, person, path.join(outputDir, 'name-slide-in-start.png'), 13);
  await still(serveUrl, person, path.join(outputDir, 'name-fully-in.png'), 42);
  await still(serveUrl, person, path.join(outputDir, 'name-slide-out.png'), 111);
  await still(serveUrl, place, path.join(outputDir, 'place-fully-in.png'), 42);
  await still(serveUrl, portrait, path.join(outputDir, 'portrait-fully-in.png'), 42);
  await still(serveUrl, brightYear, path.join(outputDir, 'year-bright-final.png'), 60);
  await clip(serveUrl, person, path.join(outputDir, 'name-clip.mp4'), 'name');
  await clip(serveUrl, brightYear, path.join(outputDir, 'year-bright-clip.mp4'), 'year-bright');

  console.log(JSON.stringify({ outputDir, projectId: project._id, sceneId: scene.id, serveUrl }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  await closeDb();
}
