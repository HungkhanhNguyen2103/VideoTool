import { getCollection } from '../../db/client';
import type { YoutubeStoredCredentialDoc, YoutubeQuotaDoc, YoutubeVideoDoc, YoutubeChannelDailyDoc, YoutubeRetentionDoc, YoutubeReviewDoc, YoutubeChannelTrafficDoc, YoutubeGrowthPlanDoc } from './docs';

export async function ensureYoutubeIndexes(): Promise<void> {
  await getCollection<YoutubeStoredCredentialDoc>('youtubeCredentials').createIndex(
    { youtubeChannelId: 1 },
    { unique: true, partialFilterExpression: { youtubeChannelId: { $type: 'string' } }, name: 'youtube_channel_binding_unique' },
  );
  await getCollection<YoutubeStoredCredentialDoc>('youtubeCredentials').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, partialFilterExpression: { kind: 'pending-import' }, name: 'youtube_pending_import_ttl' },
  );
  await getCollection<YoutubeVideoDoc>('youtubeVideos').createIndex({ channelProfileId: 1, videoId: 1 }, { unique: true, name: 'youtube_video_profile_id_unique' });
  await getCollection<YoutubeChannelDailyDoc>('youtubeChannelDaily').createIndex({ channelProfileId: 1, date: 1 }, { unique: true, name: 'youtube_daily_profile_date_unique' });
  await getCollection<YoutubeQuotaDoc>('youtubeQuota').createIndex({ date: 1, projectKey: 1 }, { unique: true, name: 'youtube_quota_project_date_unique' });
  await getCollection<YoutubeRetentionDoc>('youtubeRetention').createIndex({ channelProfileId: 1, videoId: 1 }, { unique: true, name: 'youtube_retention_profile_video_unique' });
  await getCollection<YoutubeReviewDoc>('youtubeReviews').createIndex({ channelProfileId: 1, target: 1, targetId: 1 }, { unique: true, name: 'youtube_review_profile_target_unique' });
  await getCollection<YoutubeChannelTrafficDoc>('youtubeChannelTraffic').createIndex({ channelProfileId: 1 }, { unique: true, name: 'youtube_channel_traffic_profile_unique' });
  await getCollection<YoutubeVideoDoc>('youtubeVideos').createIndex({ channelProfileId: 1, privacy: 1, isShort: 1, first28d: 1 }, { name: 'youtube_video_first28d_pending' });
  await getCollection<YoutubeGrowthPlanDoc>('youtubeGrowthPlans').createIndex({ channelProfileId: 1 }, { unique: true, name: 'youtube_growth_plan_profile_unique' });
}
