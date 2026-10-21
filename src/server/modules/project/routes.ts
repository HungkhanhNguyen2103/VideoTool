import { Router } from 'express';
import { CreateProjectRequestSchema, ListProjectsQuerySchema, SetProjectChannelRequestSchema } from '../../../contracts/project';
import * as service from './service';
import { NotFound } from '../../shared/errors';

export type ProjectDeleteHook = (project: Pick<Awaited<ReturnType<typeof service.getProject>>, 'id' | 'renderFileId' | 'draftRenderFileId' | 'logoFileId' | 'seo'>) => Promise<void>;
export type AssertChannelExists = (channelId: string) => Promise<void>;

export function createProjectRouter(options: { beforeDelete?: ProjectDeleteHook; assertChannelExists?: AssertChannelExists } = {}): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = ListProjectsQuerySchema.parse({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    res.json(await service.listProjects(query));
  });

  router.post('/', async (req, res) => {
    const input = CreateProjectRequestSchema.parse(req.body);
    if (input.channelId) await (options.assertChannelExists ?? (async () => { throw new NotFound('Không tìm thấy kênh.'); }))(input.channelId);
    res.status(201).json(await service.createProject(input));
  });

  router.patch('/:id/channel', async (req, res) => {
    const { channelId } = SetProjectChannelRequestSchema.parse(req.body);
    if (channelId !== null) await (options.assertChannelExists ?? (async () => { throw new NotFound('Không tìm thấy kênh.'); }))(channelId);
    res.json(await service.setProjectChannel(req.params.id, channelId));
  });

  router.get('/:id', async (req, res) => {
    res.json(await service.getProject(req.params.id));
  });

  router.post('/:id/duplicate', async (req, res) => {
    res.status(201).json(await service.duplicateProject(req.params.id));
  });

  router.delete('/:id', async (req, res) => {
    const project = await service.getProject(req.params.id);
    await options.beforeDelete?.(project);
    await service.deleteProject(req.params.id);
    res.status(204).end();
  });

  return router;
}

export const projectRouter = createProjectRouter();
