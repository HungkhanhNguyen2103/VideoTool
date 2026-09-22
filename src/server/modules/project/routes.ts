import { Router } from 'express';
import { CreateProjectRequestSchema, ListProjectsQuerySchema } from '../../../contracts/project';
import * as service from './service';

export const projectRouter = Router();

projectRouter.get('/', async (req, res) => {
  const query = ListProjectsQuerySchema.parse({
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });
  res.json(await service.listProjects(query));
});

projectRouter.post('/', async (req, res) => {
  const input = CreateProjectRequestSchema.parse(req.body);
  res.status(201).json(await service.createProject(input));
});

projectRouter.get('/:id', async (req, res) => {
  res.json(await service.getProject(req.params.id));
});

projectRouter.post('/:id/duplicate', async (req, res) => {
  res.status(201).json(await service.duplicateProject(req.params.id));
});

projectRouter.delete('/:id', async (req, res) => {
  await service.deleteProject(req.params.id);
  res.status(204).end();
});
