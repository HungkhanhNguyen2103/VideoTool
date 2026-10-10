import type { GenerateScriptRequest } from '../../../contracts/script';
import { AI_MODEL_REGISTRY } from '../../../contracts/ai-models';

export type ScriptGenerationBackend = 'api' | 'cli';
export type ClaudeCliModelId = (typeof AI_MODEL_REGISTRY.claude.models)[number]['id'];

export function buildScriptGenerationRequest(args: {
  backend: ScriptGenerationBackend;
  cliModel?: ClaudeCliModelId | null;
  resume: boolean;
}): GenerateScriptRequest {
  return {
    ...(args.resume ? { resume: true } : {}),
    backend: args.backend,
    ...(args.backend === 'cli' ? { cliModel: args.cliModel ?? null } : {}),
  };
}

const TASK_94_CLI_SECONDS = { outline: 203, outlineRepair: 89, chapterMin: 103, chapterMax: 191 } as const;

export function cliGenerationEstimate(chapterCount: number, includesOutline = true): { chapterCount: number; minMinutes: number; maxMinutes: number; label: string } {
  const safeChapterCount = Math.max(1, Math.floor(chapterCount));
  const outlineMin = includesOutline ? TASK_94_CLI_SECONDS.outline : 0;
  const outlineMax = includesOutline ? TASK_94_CLI_SECONDS.outline + TASK_94_CLI_SECONDS.outlineRepair : 0;
  const minMinutes = Math.ceil((outlineMin + safeChapterCount * TASK_94_CLI_SECONDS.chapterMin) / 60);
  const maxMinutes = Math.ceil((outlineMax + safeChapterCount * TASK_94_CLI_SECONDS.chapterMax) / 60);
  return {
    chapterCount: safeChapterCount,
    minMinutes,
    maxMinutes,
    label: `Ước tính khoảng ${minMinutes}–${maxMinutes} phút cho ${safeChapterCount} chương; thời gian thực tế có thể thay đổi.`,
  };
}
