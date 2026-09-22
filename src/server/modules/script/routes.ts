import { Router } from 'express';
import { z } from 'zod';
import { getProject } from '../project';
import { finalizeScript, getChapterHistory, patchChapter, regenerateChapter, restoreChapters } from './service';

type EnqueueScriptJob = (input: { type: string; projectId: string; payload: unknown }) => Promise<{ id: string }>;

const PatchChapterSchema = z.object({
  status: z.enum(['pending', 'approved', 'needs-fix']).optional(),
  paragraphs: z.array(z.string()).optional(),
  title: z.string().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one chapter field is required.');

const RegenerateChapterSchema = z.object({
  instruction: z.string(),
  level: z.enum(['light', 'medium', 'rewrite']),
});

const RestoreSchema = z.object({ index: z.number().int().nonnegative() });

function writeEvent(res: { write: (chunk: string) => boolean }, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createScriptRouter(options: { enqueueJob: EnqueueScriptJob }): Router {
  const router = Router();

  router.post('/:id/generate-script', async (req, res) => {
    const project = await getProject(req.params.id);
    const job = await options.enqueueJob({ type: 'generate-script', projectId: project.id, payload: { projectId: project.id } });
    res.status(201).json({ jobId: job.id });
  });

  router.patch('/:id/chapters/:chapterId', async (req, res) => {
    const patch = PatchChapterSchema.parse(req.body);
    res.json({ chapters: await patchChapter(req.params.id, req.params.chapterId, patch) });
  });

  router.post('/:id/chapters/:chapterId/regenerate', async (req, res) => {
    const body = RegenerateChapterSchema.parse(req.body);
    const controller = new AbortController();
    let closed = false;
    req.on('close', () => {
      // IncomingMessage can close normally after the request body is consumed;
      // response close is the reliable disconnect signal once headers are sent.
      if (!res.headersSent) { closed = true; controller.abort(); }
    });
    res.on('close', () => {
      if (!res.writableEnded) { closed = true; controller.abort(); }
    });
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    try {
      const chapter = await regenerateChapter(req.params.id, req.params.chapterId, body, (chunk) => {
        if (!closed) writeEvent(res, 'chunk', chunk);
      }, controller.signal);
      if (!closed) {
        writeEvent(res, 'done', chapter);
        res.end();
      }
    } catch (error) {
      if (!closed) {
        writeEvent(res, 'error', error instanceof Error ? error.message : String(error));
        res.end();
      }
    }
  });

  router.get('/:id/chapters/history', async (req, res) => {
    res.json(await getChapterHistory(req.params.id));
  });

  router.post('/:id/chapters/restore', async (req, res) => {
    const body = RestoreSchema.parse(req.body);
    res.json({ chapters: await restoreChapters(req.params.id, body.index) });
  });

  router.post('/:id/finalize-script', async (req, res) => {
    await finalizeScript(req.params.id);
    res.json(await getProject(req.params.id));
  });

  return router;
}
