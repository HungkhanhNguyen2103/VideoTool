import { Router } from 'express';
import { CreateChannelRequestSchema, UpdateChannelRequestSchema } from '../../../contracts/channel';
import * as service from './service';
import type { YoutubeConnectionSummary } from '../../../contracts/youtube';

export function createChannelRouter(options: { getYoutubeConnection?: (channelId: string) => Promise<YoutubeConnectionSummary> } = {}): Router {
  const router = Router();
  const withYoutube = async <T extends { id: string }>(channel: T): Promise<T & { youtube?: YoutubeConnectionSummary }> => ({
    ...channel,
    ...(options.getYoutubeConnection ? { youtube: await options.getYoutubeConnection(channel.id) } : {}),
  });

  router.get('/', async (_req, res) => {
    const channels = await service.listChannels();
    res.json(await Promise.all(channels.map(withYoutube)));
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await withYoutube(await service.createChannel(CreateChannelRequestSchema.parse(req.body))));
  });

  router.get('/:id', async (req, res) => {
    res.json(await withYoutube(await service.getChannel(req.params.id)));
  });

  router.patch('/:id', async (req, res) => {
    res.json(await withYoutube(await service.updateChannel(req.params.id, UpdateChannelRequestSchema.parse(req.body))));
  });

  router.delete('/:id', async (req, res) => {
    await service.deleteChannel(req.params.id);
    res.status(204).end();
  });

  return router;
}
