import { Router } from 'express';
import { CreateChannelRequestSchema, UpdateChannelRequestSchema } from '../../../contracts/channel';
import * as service from './service';

export function createChannelRouter(): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await service.listChannels());
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await service.createChannel(CreateChannelRequestSchema.parse(req.body)));
  });

  router.get('/:id', async (req, res) => {
    res.json(await service.getChannel(req.params.id));
  });

  router.patch('/:id', async (req, res) => {
    res.json(await service.updateChannel(req.params.id, UpdateChannelRequestSchema.parse(req.body)));
  });

  router.delete('/:id', async (req, res) => {
    await service.deleteChannel(req.params.id);
    res.status(204).end();
  });

  return router;
}
