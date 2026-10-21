import { closeDb, connectDb, getDb } from '../src/server/db/client';
import { SeoPackageSchema } from '../src/contracts/seo';
import { ChannelDocSchema } from '../src/server/modules/channel/docs';
import { ProjectDocSchema } from '../src/server/modules/project/docs';
import { YoutubeChannelDailyDocSchema, YoutubeCredentialDocSchema, YoutubeRetentionDocSchema, YoutubeReviewDocSchema, YoutubeVideoDocSchema } from '../src/server/modules/youtube/docs';
import { ensureYoutubeIndexes } from '../src/server/modules/youtube/indexes';

const seedPrefix = 'youtube-demo-';
const seedStamp = '20261022';
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const offsetDays = (base: Date, amount: number) => new Date(base.getTime() + amount * 86_400_000);

function requireSafeTarget(): { uri: string; database: string } {
  const uri = process.env.YOUTUBE_SEED_MONGODB_URI;
  const database = process.env.YOUTUBE_SEED_MONGODB_DB;
  if (!uri || !database) throw new Error('Set YOUTUBE_SEED_MONGODB_URI and YOUTUBE_SEED_MONGODB_DB for an isolated local demo database.');
  const parsed = new URL(uri);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || !database.startsWith('youtube_demo_')) {
    throw new Error('Refusing to seed: use a localhost MongoDB URI and a database name that starts with youtube_demo_.');
  }
  return { uri, database };
}

function makeChannel(id: string, name: string, handle: string) {
  const now = new Date();
  return ChannelDocSchema.parse({
    _id: id,
    schemaVersion: 1,
    name,
    nameSearch: name.toLocaleLowerCase('vi'),
    handle,
    tagline: 'Dữ liệu minh họa Task 112',
    description: 'Hồ sơ demo cục bộ. Không đại diện số liệu thật.',
    language: 'vi',
    links: [],
    defaultHashtags: [],
    descriptionFooter: '',
    publishSchedule: { timezone: 'Asia/Ho_Chi_Minh', slots: [], notes: '' },
    createdAt: now,
    updatedAt: now,
  });
}

function makeProject(id: string, channelId: string, title: string, chosenTitle: string, youtubeVideoId: string | null, createdAt: Date, scriptPresetId: 'documentary' | 'explainer' | 'hubris-trap' | 'strategist', visualStylePresetId: 'cinematic' | 'anime' | 'watercolor' | 'photorealistic' | 'flat-cartoon' | 'strategic-map') {
  return ProjectDocSchema.parse({
    _id: id,
    schemaVersion: 1,
    title,
    titleSearch: title.toLocaleLowerCase('vi'),
    language: 'vi',
    brief: `Dự án demo: ${title}`,
    referencesText: '',
    scriptPresetId,
    visualStylePresetId,
    targetDurationSec: 600,
    chapterCount: 5,
    voiceId: null,
    channelId,
    youtubeVideoId,
    aiProvider: 'deepseek',
    aiModel: 'deepseek-chat',
    renderEngine: 'ffmpeg',
    keywordPopupsEnabled: true,
    popupDensity: 'low',
    transitionStyle: 'varied',
    filmLook: 'auto',
    parallax: 'off',
    voiceoverVoice: 'Truc Ly',
    voiceSpeed: 1,
    sceneTailSec: 0,
    sfxVolume: 0.5,
    renderFileId: null,
    draftRenderFileId: null,
    bgmMood: '',
    bgmFileId: null,
    logoFileId: null,
    customStyleReferenceFileId: null,
    seo: SeoPackageSchema.parse({
      titles: [{ id: 'chosen-title', text: chosenTitle, angle: 'curiosity' }],
      chosenTitleId: 'chosen-title',
    }),
    renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
    status: 'rendered',
    scenes: [],
    chapters: [],
    openLoops: [],
    motif: null,
    coreQuestion: '',
    openingHook: '',
    version: 1,
    createdAt,
    updatedAt: new Date(),
  });
}

function makeCredential(id: string, youtubeChannelId: string, title: string, subscriberCount: number, needsReconnect = false) {
  const now = new Date();
  return YoutubeCredentialDocSchema.parse({
    _id: id,
    schemaVersion: 1,
    refreshToken: { algorithm: 'aes-256-gcm', iv: 'demo-only', authTag: 'demo-only', ciphertext: 'demo-only' },
    youtubeChannelId,
    title,
    handle: `@demo-${id.slice(-4)}`,
    connectedAt: offsetDays(now, -15),
    lastSyncAt: offsetDays(now, -0.2),
    needsReconnect,
    subscriberCount,
    channelOptions: [],
    lastSyncReport: {
      channelDaily90d: { status: 'ok' }, videos_28d: { status: 'ok' }, videos_90d: { status: 'ok' },
      videos_365d: { status: 'ok' }, videos_lifetime: { status: 'ok' }, retentionTopVideos: { status: 'ok' },
    },
  });
}

function makeVideo(channelProfileId: string, index: number, now: Date) {
  const videoId = `demo-video-${String(index + 1).padStart(2, '0')}`;
  const title = index === 0 ? 'Vì sao thành cổ biến mất? 5 nguyên nhân ít ai biết' : index === 1 ? 'Cuộc vây hãm kéo dài 100 ngày' : index % 3 === 0 ? `3 bí mật của kinh thành số ${index + 1}` : `Câu chuyện lịch sử ${index + 1}: điều gì đã xảy ra?`;
  const publishedAt = offsetDays(now, -(index * 4 + 5)).toISOString();
  const isShort = index % 5 === 4;
  const viewCount = 18_000 - index * 430;
  const averageViewPercentage = Math.max(18, 62 - index * 1.25);
  const perWindow = (days: number) => {
    const views = Math.max(100, Math.round(viewCount * Math.min(days / Math.max(1, index * 4 + 5), 1)));
    return {
      views,
      estimatedMinutesWatched: Math.round(views * (isShort ? 0.6 : 5.2)),
      averageViewDurationSec: isShort ? 27 : 310 - index * 4,
      averageViewPercentage,
      subscribersGained: Math.max(1, Math.round(views / 850)),
      subscribersLost: Math.max(0, Math.round(views / 3_500)),
    };
  };
  return YoutubeVideoDocSchema.parse({
    _id: `${channelProfileId}:${videoId}`,
    channelProfileId,
    videoId,
    title,
    publishedAt,
    durationSec: isShort ? 43 + index : 540 + index * 31,
    isShort,
    privacy: index === 22 ? 'unlisted' : index === 23 ? 'private' : 'public',
    viewCount,
    likeCount: Math.round(viewCount * 0.034),
    commentCount: Math.round(viewCount * 0.006),
    fetchedAt: now.toISOString(),
    analytics: { '28d': perWindow(28), '90d': perWindow(90), '365d': perWindow(365), lifetime: perWindow(365) },
    removed: false,
  });
}

async function main() {
  const { uri, database } = requireSafeTarget();
  await connectDb(uri, database);
  const db = getDb();
  const demoIds = [
    `${seedPrefix}full-${seedStamp}`,
    `${seedPrefix}empty-${seedStamp}`,
    `${seedPrefix}unavailable-${seedStamp}`,
    `${seedPrefix}disconnected-${seedStamp}`,
    `${seedPrefix}reconnect-${seedStamp}`,
  ];
  await Promise.all([
    db.collection('channels').deleteMany({ _id: { $in: demoIds } }),
    db.collection('projects').deleteMany({ _id: { $regex: `^${seedPrefix}` } }),
    db.collection('youtubeCredentials').deleteMany({ _id: { $in: demoIds } }),
    db.collection('youtubeVideos').deleteMany({ channelProfileId: { $in: demoIds } }),
    db.collection('youtubeChannelDaily').deleteMany({ channelProfileId: { $in: demoIds } }),
    db.collection('youtubeRetention').deleteMany({ channelProfileId: { $in: demoIds } }),
    db.collection('youtubeReviews').deleteMany({ channelProfileId: { $in: demoIds } }),
  ]);

  const [full, empty, unavailable, disconnected, reconnect] = demoIds;
  const channels = [
    makeChannel(full!, 'Demo · Đầy đủ', '@demo-full'),
    makeChannel(empty!, 'Demo · Trống', '@demo-empty'),
    makeChannel(unavailable!, 'Demo · Chưa có Analytics', '@demo-no-data'),
    makeChannel(disconnected!, 'Demo · Chưa kết nối', '@demo-offline'),
    makeChannel(reconnect!, 'Demo · Cần kết nối lại', '@demo-reconnect'),
  ];
  await db.collection('channels').insertMany(channels);
  await ensureYoutubeIndexes();

  const now = new Date();
  const fullCredentials = [
    makeCredential(full!, 'UC-DEMO-FULL', 'Demo · Đầy đủ', 2_480),
    makeCredential(empty!, 'UC-DEMO-EMPTY', 'Demo · Trống', 42),
    makeCredential(unavailable!, 'UC-DEMO-NODATA', 'Demo · Chưa có Analytics', 180),
    makeCredential(reconnect!, 'UC-DEMO-RECONNECT', 'Demo · Cần kết nối lại', 760, true),
  ];
  fullCredentials[2]!.lastSyncReport = {
    channelDaily90d: { status: 'unavailable', message: 'No data for demo scenario.' },
    videos_28d: { status: 'unavailable', message: 'No data for demo scenario.' },
    videos_90d: { status: 'unavailable', message: 'No data for demo scenario.' },
    videos_365d: { status: 'unavailable', message: 'No data for demo scenario.' },
    videos_lifetime: { status: 'unavailable', message: 'No data for demo scenario.' },
    retentionTopVideos: { status: 'unavailable', message: 'No data for demo scenario.' },
  };
  await db.collection('youtubeCredentials').insertMany(fullCredentials);

  const videos = Array.from({ length: 24 }, (_unused, index) => makeVideo(full!, index, now));
  await db.collection('youtubeVideos').insertMany(videos);

  const daily = Array.from({ length: 90 }, (_unused, index) => {
    const date = dateOnly(offsetDays(now, -(91 - index)));
    const views = 180 + index * 14 + (index % 6) * 35;
    return YoutubeChannelDailyDocSchema.parse({
      _id: `${full}:${date}`, channelProfileId: full!, date, views,
      estimatedMinutesWatched: views * 6.2,
      subscribersGained: 3 + (index % 5), subscribersLost: 1 + (index % 2),
    });
  });
  await db.collection('youtubeChannelDaily').insertMany(daily);

  const longVideos = videos.filter((video) => !video.isShort).slice(0, 15);
  const retentionDocs = longVideos.map((video) => YoutubeRetentionDocSchema.parse({
    _id: `${full}:${video.videoId}`, channelProfileId: full!, videoId: video.videoId, fetchedAt: now,
    curve: Array.from({ length: 101 }, (_unused, index) => {
      const ratio = index / 100;
      const openingDrop = ratio < 0.08 ? ratio * 3.2 : 0.256;
      const gradual = Math.max(0, ratio - 0.08) * 0.58;
      return { ratio, watchRatio: Math.max(0.08, 1 - openingDrop - gradual) };
    }),
  }));
  await db.collection('youtubeRetention').insertMany(retentionDocs);

  const linkedProjectId = `${seedPrefix}project-linked`;
  const suggestionProjectId = `${seedPrefix}project-suggestion`;
  await db.collection('projects').insertMany([
    makeProject(linkedProjectId, full!, 'Demo · Đã liên kết', 'Cuộc vây hãm kéo dài 100 ngày', 'demo-video-02', offsetDays(now, -20), 'documentary', 'cinematic'),
    makeProject(suggestionProjectId, full!, 'Demo · Gợi ý liên kết', 'Vì sao thành cổ biến mất?', null, offsetDays(now, -29), 'strategist', 'photorealistic'),
  ]);

  const reviewResult = { observations: ['Kênh có đủ dữ liệu minh họa cho hai cửa sổ gần nhất.'], hypotheses: ['Mở đầu ngắn hơn có thể giúp giữ người xem; đây là giả thuyết cần thử.'], experiments: ['So sánh tỷ lệ xem trung bình của hai video gần nhất.'] };
  await db.collection('youtubeReviews').insertMany([
    YoutubeReviewDocSchema.parse({ _id: `${full}:channel:channel`, channelProfileId: full!, target: 'channel', targetId: 'channel', promptVersion: 'youtube-review-v1', dataWindow: '28d vs previous 28d', result: reviewResult, generatedAt: now }),
    YoutubeReviewDocSchema.parse({ _id: `${full}:video:demo-video-02`, channelProfileId: full!, target: 'video', targetId: 'demo-video-02', promptVersion: 'youtube-review-v1', dataWindow: '28d', result: reviewResult, generatedAt: now }),
  ]);

  console.log(`Seeded Task 112 demo data into isolated database ${database}.`);
  console.log(`Analytics scenarios: ${full}, ${empty}, ${unavailable}; connection scenarios: ${disconnected}, ${reconnect}.`);
  console.log(`Demo project IDs: ${linkedProjectId}, ${suggestionProjectId}. No OAuth tokens or real channel data were used.`);
}

main().catch(() => {
  console.error('Task 112 demo seed failed. Check the isolated local MongoDB target and seeded document schemas.');
  process.exitCode = 1;
}).finally(() => closeDb());
