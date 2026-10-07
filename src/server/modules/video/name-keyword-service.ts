import { z } from 'zod';
import { NameCandidateSchema, type AiProvider, type NameCandidate, type ProjectDetail, type Scene } from '../../../contracts/project';
import { areNameCandidatesFresh } from '../../../contracts/name-keywords';
import { hashNarration } from '../../../contracts/name-keywords';
import { getAiClient, type AiClient, type ChatMessage } from '../../shared/ai';
import { logger } from '../../shared/logger';
import { AppError } from '../../shared/errors';
import { getProject, setProjectSceneNameCandidates } from '../project';
import { validateNameCandidate } from './name-keywords';

export const NAME_KEYWORD_SYSTEM_PROMPT = [
  'You extract important proper names and named places from Vietnamese documentary narration.',
  'Return only valid JSON with this exact top-level shape: {"scenes":[{"scene":1,"candidates":[{"phrase":"...","kind":"person|place|event|group","role":"..."}]}]}.',
  'For every scene, return at most two candidates, ordered by importance, most important first. Omit candidates when no important named entity is present; in that case, return an empty candidates array.',
  'When several names are equally important, order them by first appearance in the narration.',
  'Copy each phrase verbatim from the narration (same wording, contiguous words), including generic prefixes that belong to the proper name: "Sông Tiền", "Trận Rạch Gầm", "Quân Xiêm".',
  'Do not return generic nouns such as "trận đánh" or "quân đội" unless they are part of a proper name.',
  'A role is a title before a person\'s name, such as "Tướng" or "Vua"; it is not part of phrase.',
  'Do not invent, normalize, translate, or combine words that are not contiguous in the narration.',
].join('\n');

const CandidateResponseSchema = z.object({
  scenes: z.array(z.object({
    scene: z.number().int().positive(),
    candidates: z.array(NameCandidateSchema.strict()).max(2),
  }).strict()),
}).strict();

const MAX_TOKENS = 8_000;

export type NameKeywordAnalysisSummary = {
  scenesAnalyzed: number;
  scenesSkippedNoTimings: number;
  scenesWithName: number;
  rejectedCandidates: number;
  provider: AiProvider;
  model: string;
};

type EligibleScene = { sceneNo: number; scene: Scene };
type NameKeywordClientResolver = (provider: AiProvider) => AiClient;

function userPrompt(scenes: readonly EligibleScene[]): string {
  return [
    'Extract names and places from these numbered scene narrations. Return one scenes entry for every supplied number, preserving those numbers exactly.',
    ...scenes.map(({ sceneNo, scene }) => `Scene ${sceneNo}: ${scene.narration}`),
  ].join('\n\n');
}

function parseResponse(raw: string, eligibleSceneNumbers: ReadonlySet<number>): Map<number, NameCandidate[]> {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const parsed = CandidateResponseSchema.parse(JSON.parse(unfenced) as unknown);
  const sceneNumbers = parsed.scenes.map((scene) => scene.scene);
  if (sceneNumbers.length !== eligibleSceneNumbers.size || new Set(sceneNumbers).size !== sceneNumbers.length
    || sceneNumbers.some((sceneNo) => !eligibleSceneNumbers.has(sceneNo))) {
    throw new Error('AI scenes must exactly match the requested scene numbers.');
  }
  return new Map(parsed.scenes.map((scene) => [scene.scene, scene.candidates]));
}

function eligibleScenes(project: ProjectDetail): EligibleScene[] {
  return project.scenes.flatMap((scene, index) => scene.narration.trim()
    && scene.audioFileId
    && scene.wordTimings?.audioFileId === scene.audioFileId
    && scene.wordTimings.words.length > 0
    ? [{ sceneNo: index + 1, scene }]
    : []);
}

function messagesFor(scenes: readonly EligibleScene[]): ChatMessage[] {
  return [
    { role: 'system', content: NAME_KEYWORD_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(scenes) },
  ];
}

function parseWithRetry(raw: string, sceneNumbers: ReadonlySet<number>): Map<number, NameCandidate[]> {
  return parseResponse(raw, sceneNumbers);
}

export async function analyzeProjectNameKeywords(
  projectId: string,
  clientResolver: NameKeywordClientResolver = getAiClient,
): Promise<NameKeywordAnalysisSummary> {
  const project = await getProject(projectId);
  const scenes = eligibleScenes(project);
  const client = clientResolver(project.aiProvider);
  const summary: NameKeywordAnalysisSummary = {
    scenesAnalyzed: scenes.length,
    scenesSkippedNoTimings: project.scenes.length - scenes.length,
    scenesWithName: 0,
    rejectedCandidates: 0,
    provider: project.aiProvider,
    model: client.model,
  };
  if (scenes.length === 0) {
    logger.info(`Name popup analysis skipped: no scenes with current narration timings in project ${projectId}.`);
    return summary;
  }

  const requestedNumbers = new Set(scenes.map(({ sceneNo }) => sceneNo));
  let candidatesByScene: Map<number, NameCandidate[]> | null = null;
  let lastParseError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      raw = await client.chat(messagesFor(scenes), { json: true, maxTokens: MAX_TOKENS, temperature: 0 });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Không thể gọi AI để phân tích tên popup.', 502, 'NAME_KEYWORD_ANALYSIS_FAILED');
    }
    try {
      candidatesByScene = parseWithRetry(raw, requestedNumbers);
      break;
    } catch (error) {
      lastParseError = error;
      if (error instanceof SyntaxError && attempt === 0) {
        logger.warn(`Name popup AI returned invalid JSON; retrying once: ${error.message}`);
        continue;
      }
      break;
    }
  }
  if (!candidatesByScene) {
    logger.warn(`Name popup analysis failed for project ${projectId}: invalid response after retry.`, lastParseError);
    throw new AppError('AI trả về JSON tên popup không hợp lệ; dữ liệu hiện tại được giữ nguyên.', 422, 'NAME_KEYWORD_ANALYSIS_FAILED');
  }

  const generatedAt = new Date().toISOString();
  const updates = [];
  let acceptedCount = 0;
  for (const { sceneNo, scene } of scenes) {
    const rawCandidates = candidatesByScene.get(sceneNo) ?? [];
    const accepted: NameCandidate[] = [];
    for (const candidate of rawCandidates) {
      const validation = validateNameCandidate(scene.narration, scene.wordTimings!.words, candidate);
      if (!validation.accepted) {
        summary.rejectedCandidates += 1;
        continue;
      }
      accepted.push(candidate);
    }
    acceptedCount += accepted.length;
    if (accepted.length > 0) summary.scenesWithName += 1;
    updates.push({
      sceneId: scene.id,
      expectedNarration: scene.narration,
      expectedAudioFileId: scene.audioFileId!,
      nameCandidates: {
        narrationHash: hashNarration(scene.narration),
        audioFileId: scene.audioFileId!,
        provider: project.aiProvider,
        model: client.model,
        generatedAt,
        candidates: accepted,
      },
    });
  }

  if (acceptedCount === 0 && summary.rejectedCandidates > 0) {
    throw new AppError('AI không trả về tên popup nào khớp với lời dẫn và căn chỉnh âm thanh; dữ liệu hiện tại được giữ nguyên.', 422, 'NAME_CANDIDATES_REJECTED');
  }
  const applied = await setProjectSceneNameCandidates(projectId, updates);
  if (applied < updates.length) logger.warn(`Name popup analysis wrote ${applied}/${updates.length} scenes; some scene snapshots changed while AI was running.`);

  logger.info(`Name popup analysis: ${JSON.stringify(summary)}.`);
  return summary;
}

export async function autoAnalyzeProjectNameKeywordsIfStale(
  projectId: string,
  appendLog?: (message: string) => Promise<void>,
  analyzer: typeof analyzeProjectNameKeywords = analyzeProjectNameKeywords,
): Promise<boolean> {
  const project = await getProject(projectId);
  const needsAnalysis = project.scenes.some((scene) => scene.narration.trim()
    && scene.audioFileId
    && scene.wordTimings?.audioFileId === scene.audioFileId
    && scene.wordTimings.words.length > 0
    && !areNameCandidatesFresh(scene.nameCandidates, scene.narration, scene.audioFileId));
  if (!needsAnalysis) return false;
  try {
    const summary = await analyzer(projectId);
    try { await appendLog?.(`Name popup auto-analysis: ${JSON.stringify(summary)}.`); }
    catch (error) { logger.warn('Name popup auto-analysis log write failed.', error); }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Name popup auto-analysis failed for project ${projectId}; alignment remains complete: ${message}`);
    try { await appendLog?.(`Name popup auto-analysis skipped: ${message}`); }
    catch (logError) { logger.warn('Name popup auto-analysis failure log write failed.', logError); }
    return false;
  }
}
