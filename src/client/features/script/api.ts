import { z } from 'zod';
import type { ProjectDetail } from '../../../contracts/project';
import { ProjectDetailSchema } from '../../../contracts/project';
import { ChapterDocSchema, type ChapterDoc, type ChapterSnapshot } from '../../../contracts/script';
import { apiRequest } from '../../shared/api-client';

export type { ChapterSnapshot } from '../../../contracts/script';

export type SseFrame = { event: string; data: string };

export function parseSseFrames(input: string): { frames: SseFrame[]; remainder: string } {
  const chunks = input.split('\n\n');
  const remainder = chunks.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const chunk of chunks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) frames.push({ event, data: data.join('\n') });
  }
  return { frames, remainder };
}

const ChaptersResponseSchema = z.object({ chapters: z.array(ChapterDocSchema) });
const JobResponseSchema = z.object({ jobId: z.string() });
const HistoryResponseSchema = z.array(z.object({ takenAt: z.coerce.date(), chapters: z.array(ChapterDocSchema) }));

export function getProject(id: string): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(id)}`, ProjectDetailSchema);
}

export function generateScript(projectId: string): Promise<{ jobId: string }> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/generate-script`, JobResponseSchema, { method: 'POST' });
}

export async function patchChapter(
  projectId: string,
  chapterId: string,
  body: { status?: 'approved' | 'needs-fix'; paragraphs?: string[]; title?: string },
): Promise<ChapterDoc[]> {
  const response = await apiRequest(`/api/project/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`, ChaptersResponseSchema, {
    method: 'PATCH', body,
  });
  return response.chapters;
}

export async function regenerateChapter(
  projectId: string,
  chapterId: string,
  body: { instruction: string; level: 'light' | 'medium' | 'rewrite' },
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<ChapterDoc> {
  const response = await fetch(`/api/project/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/regenerate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!response.ok || !response.body) throw new Error(`Regeneration failed (${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ChapterDoc | null = null;
  const consume = (text: string) => {
    buffer += text;
    const parsed = parseSseFrames(buffer);
    buffer = parsed.remainder;
    for (const frame of parsed.frames) {
      if (frame.event === 'chunk') onChunk(JSON.parse(frame.data) as string);
      else if (frame.event === 'done') result = ChapterDocSchema.parse(JSON.parse(frame.data));
      else if (frame.event === 'error') throw new Error(JSON.parse(frame.data) as string);
    }
  };
  while (true) {
    const next = await reader.read();
    if (next.done) {
      consume(decoder.decode());
      break;
    }
    consume(decoder.decode(next.value, { stream: true }));
  }
  if (!result) throw new Error('Regeneration ended without a done event.');
  return result;
}

export async function getChapterHistory(projectId: string): Promise<ChapterSnapshot[]> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/chapters/history`, HistoryResponseSchema);
}

export async function restoreChapters(projectId: string, index: number): Promise<ChapterDoc[]> {
  const response = await apiRequest(`/api/project/${encodeURIComponent(projectId)}/chapters/restore`, ChaptersResponseSchema, {
    method: 'POST', body: { index },
  });
  return response.chapters;
}

export function finalizeScript(projectId: string): Promise<ProjectDetail> {
  return apiRequest(`/api/project/${encodeURIComponent(projectId)}/finalize-script`, ProjectDetailSchema, { method: 'POST' });
}
