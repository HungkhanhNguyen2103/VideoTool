import { Router } from 'express';
import { CreateProjectRequestSchema, ListProjectsQuerySchema } from '../../../contracts/project';
import * as service from './service';

export type ProjectDeleteHook = (project: Pick<Awaited<ReturnType<typeof service.getProject>>, 'id' | 'renderFileId' | 'draftRenderFileId' | 'logoFileId'>) => Promise<void>;

export function createProjectRouter(options: { beforeDelete?: ProjectDeleteHook } = {}): Router {
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
    res.status(201).json(await service.createProject(input));
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
