import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config';
import { AppError, NotFound } from '../../shared/errors';
import { getProject, setProjectYoutubeVideo } from '../project';
import { getYoutubeConnection } from './service';
import { listVideoDocs } from './repo';

const LinkVideoSchema = z.object({ videoId: z.string().min(1).max(64) }).strict();

export function createYoutubeProjectRouter(config: Config): Router {
  const router = Router();

  router.put('/:id/youtube-video', async (req, res) => {
    const project = await getProject(req.params.id);
    if (!project.channelId) throw new AppError('Gắn kênh YouTube vào dự án trước khi liên kết video.', 409, 'PROJECT_CHANNEL_REQUIRED');
    const { videoId } = LinkVideoSchema.parse(req.body);
    const connection = await getYoutubeConnection(project.channelId, config);
    if (!connection.connected) throw new AppError('Kênh của dự án chưa được kết nối YouTube.', 409, 'YOUTUBE_NOT_CONNECTED');
    const video = (await listVideoDocs(project.channelId, { videoId, removed: { $ne: true } }))[0];
    if (!video) throw new NotFound('Video chưa được đồng bộ hoặc không thuộc kênh của dự án.');
    res.json(await setProjectYoutubeVideo(project.id, videoId));
  });

  router.delete('/:id/youtube-video', async (req, res) => {
    res.json(await setProjectYoutubeVideo(req.params.id, null));
  });

  return router;
}
