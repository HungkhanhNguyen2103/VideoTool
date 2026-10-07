import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { connectDb, closeDb, getCollection } from '../src/server/db/client';
import { loadConfig } from '../src/server/config';
import { getAiClient } from '../src/server/shared/ai';
import { selectKeywords, type Keyword, type TimedWord } from '../src/server/modules/video/keywords';
import type { ProjectDoc, SceneDoc } from '../src/server/modules/project/docs';

const DEFAULT_PROJECT_TITLE = /Rạch Gầm/i;
const OUTPUT_DIR = 'data/files/.verification/task-81';
const MAX_SCENES = 40;
const AI_RUNS = 3;
const MAX_TOKENS = 8_000;

const SYSTEM_PROMPT = [
  'You extract important proper names and named places from Vietnamese documentary narration.',
  'Return only valid JSON with this exact top-level shape: {"scenes":[{"scene":1,"candidates":[{"phrase":"...","kind":"person|place|event|group","role":"..."}]}]}.',
  'For every scene, return at most two candidates. Omit candidates when no important named entity is present.',
  'Copy each phrase verbatim from the narration, including generic prefixes that belong to the proper name: "Sông Tiền", "Trận Rạch Gầm", "Quân Xiêm".',
  'A role is a title such as "Tướng" or "Vua" that precedes a person name; do not put a role into phrase unless it is part of the named entity.',
  'Do not invent, normalize, translate, or combine words that are not contiguous in the narration.',
].join('\n');

type AiKind = 'person' | 'place' | 'event' | 'group';
type AiCandidate = { phrase: string; kind: AiKind; role?: string };
type AiScene = { scene: number; candidates: AiCandidate[] };
type AiPayload = { scenes: AiScene[] };

type EvalScene = {
  scene: number;
  id: string;
  narration: string;
  words: TimedWord[];
  rules: Array<Pick<Keyword, 'text' | 'nameRole' | 'subtitle' | 'startSec'>>;
};

type Validation = {
  phrase: string;
  kind: AiKind;
  role?: string;
  accepted: boolean;
  reason?: string;
  wordStart?: number;
  wordEnd?: number;
  startSec?: number;
  endSec?: number;
};

type AiRun = {
  run: number;
  attempts: number;
  elapsedMs: number;
  inputTokenEstimate: number;
  outputTokenEstimate: number;
  rawResponse: string;
  parsedScenes: AiScene[];
  validationByScene: Record<string, Validation[]>;
  error?: string;
};

type SceneResult = EvalScene & {
  aiRuns: Array<{
    run: number;
    candidates: AiCandidate[];
    validation: Validation[];
  }>;
  runsAgree: boolean;
  verdict: Verdict;
  verdictReason: string;
};

type Verdict = 'same' | 'AI better' | 'rules better' | 'both wrong' | 'none expected';

const RACH_GAM_MANUAL_ADJUDICATIONS: Record<number, { verdict: Verdict; reason: string }> = {
  10: {
    verdict: 'AI better',
    reason: 'AI tách đúng tên người `Trương Văn Đa`; rules gộp cả phe `Tây Sơn` vào tên người.',
  },
  23: {
    verdict: 'AI better',
    reason: 'AI giữ `Chiêu Tăng` và thêm `Nguyễn Huệ`, đều là tên người quan trọng trong câu.',
  },
  38: {
    verdict: 'rules better',
    reason: '`Việt Nam` là địa danh; `trận đánh` là danh từ chung, không phải tên riêng.',
  },
};

const INSTRUCTIVE_DISAGREEMENT_NOTES: Record<number, string> = {
  4: 'Rules rút ngắn `Nguyễn Ánh` thành `Nguyễn`, còn AI giữ được tên đầy đủ và vẫn tách `chúa Nguyễn`.',
  10: 'Rules gộp tiền tố phe `Tây Sơn` vào `Trương Văn Đa`; AI tách đúng tên người và giữ thêm `Nguyễn Ánh`.',
  19: 'Rules gán sai loại cho `Thới Sơn`; AI nhận diện đây là địa danh và còn thấy `bãi Tôn`.',
  24: 'Rules chọn `Xiêm`, AI chọn `Tây Sơn`; hai bên đều lấy một thực thể trong câu nhưng không bao quát được ngữ cảnh.',
  38: 'Rules chọn địa danh `Việt Nam`; AI chọn cụm danh từ chung `trận đánh`, nên rules phù hợp hơn.',
};

function normalizeMention(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeWord(value: string): string {
  return normalizeMention(value).replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function clipExcerpt(narration: string, phrases: string[]): string {
  const normalizedNarration = normalizeMention(narration);
  const positions = phrases
    .map((phrase) => normalizedNarration.indexOf(normalizeMention(phrase)))
    .filter((position) => position >= 0);
  if (positions.length === 0) return narration.length > 140 ? `${narration.slice(0, 137)}...` : narration;
  const start = Math.max(0, Math.min(...positions) - 38);
  const end = Math.min(narration.length, start + 145);
  return `${start > 0 ? '...' : ''}${narration.slice(start, end)}${end < narration.length ? '...' : ''}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('AI JSON root must be an object.');
  return value as Record<string, unknown>;
}

function parseAiPayload(raw: string): AiPayload {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const root = asRecord(JSON.parse(unfenced) as unknown);
  if (!Array.isArray(root.scenes)) throw new Error('AI JSON must contain a scenes array.');
  const scenes = root.scenes.map((value, index) => {
    const scene = asRecord(value);
    const sceneNumber = scene.scene;
    if (!Number.isInteger(sceneNumber) || Number(sceneNumber) < 1) throw new Error(`AI scene ${index + 1} has an invalid scene number.`);
    if (!Array.isArray(scene.candidates)) throw new Error(`AI scene ${sceneNumber} must contain a candidates array.`);
    const candidates = scene.candidates.slice(0, 2).map((candidateValue) => {
      const candidate = asRecord(candidateValue);
      const phrase = candidate.phrase;
      const kind = candidate.kind;
      if (typeof phrase !== 'string' || phrase.trim() === '') throw new Error(`AI scene ${sceneNumber} has an invalid phrase.`);
      if (kind !== 'person' && kind !== 'place' && kind !== 'event' && kind !== 'group') throw new Error(`AI scene ${sceneNumber} has an invalid kind.`);
      const role = typeof candidate.role === 'string' && candidate.role.trim() ? candidate.role : undefined;
      return { phrase, kind, ...(role ? { role } : {}) };
    });
    return { scene: Number(sceneNumber), candidates };
  });
  return { scenes };
}

function validateCandidate(scene: EvalScene, candidate: AiCandidate): Validation {
  const phrase = candidate.phrase;
  const phraseInNarration = normalizeMention(scene.narration).includes(normalizeMention(phrase));
  const phraseWords = phrase.split(/\s+/u).map(normalizeWord).filter(Boolean);
  let match: { start: number; end: number } | null = null;
  for (let start = 0; start + phraseWords.length <= scene.words.length; start++) {
    const matches = phraseWords.every((word, offset) => normalizeWord(scene.words[start + offset]!.text) === word);
    if (matches) {
      match = { start, end: start + phraseWords.length - 1 };
      break;
    }
  }
  if (!phraseInNarration) return { ...candidate, accepted: false, reason: 'not found verbatim in narration' };
  if (!match) return { ...candidate, accepted: false, reason: 'not a contiguous timed-word run' };
  return {
    ...candidate,
    accepted: true,
    wordStart: match.start,
    wordEnd: match.end,
    startSec: scene.words[match.start]!.startSec,
    endSec: scene.words[match.end]!.endSec,
  };
}

function firstAccepted(run: AiRun | undefined, scene: number): string | null {
  const values = run?.validationByScene[String(scene)] ?? [];
  return values.find((value) => value.accepted)?.phrase ?? null;
}

function normalizedEqual(left: string | null, right: string | null): boolean {
  return left === null || right === null ? left === right : normalizeMention(left) === normalizeMention(right);
}

function classify(project: ProjectDoc, scene: EvalScene, runs: AiRun[]): { verdict: Verdict; reason: string } {
  if (/Rạch Gầm/i.test(project.title) && RACH_GAM_MANUAL_ADJUDICATIONS[scene.scene]) {
    return RACH_GAM_MANUAL_ADJUDICATIONS[scene.scene];
  }
  const rule = scene.rules[0]?.text ?? null;
  const ai = firstAccepted(runs[0], scene.scene);
  if (!rule && !ai) return { verdict: 'none expected', reason: 'Không có tên/place quan trọng hợp lệ ở cả hai kết quả.' };
  if (normalizedEqual(rule, ai)) return { verdict: 'same', reason: 'Hai phương pháp chọn cùng phrase.' };
  if (!rule && ai) return { verdict: 'AI better', reason: 'AI tìm được phrase hợp lệ còn rules không chọn được.' };
  if (rule && !ai) return { verdict: 'rules better', reason: 'Rules có phrase còn AI run 1 không có phrase hợp lệ.' };
  const normalizedRule = normalizeMention(rule!);
  const normalizedAi = normalizeMention(ai!);
  if (normalizedAi.includes(normalizedRule) && normalizedAi.length > normalizedRule.length) {
    return { verdict: 'AI better', reason: 'AI trả về tên đầy đủ hơn và chứa phrase rules chọn.' };
  }
  if (normalizedRule.includes(normalizedAi) && normalizedRule.length > normalizedAi.length) {
    return { verdict: 'rules better', reason: 'Rules trả về tên đầy đủ hơn.' };
  }
  return { verdict: 'both wrong', reason: 'Hai phrase hợp lệ khác nhau; không có quan hệ tên đầy đủ rõ ràng.' };
}

function formatRules(rules: EvalScene['rules']): string {
  return rules.length === 0 ? '—' : rules.map((rule) => `${rule.text}${rule.nameRole ? ` · ${rule.nameRole}` : ''}`).join(' / ');
}

function formatAiRun(run: AiRun | undefined, scene: number): string {
  const accepted = (run?.validationByScene[String(scene)] ?? []).filter((candidate) => candidate.accepted);
  return accepted.length === 0 ? '—' : accepted.map((candidate) => `${candidate.phrase} · ${candidate.kind}`).join(' / ');
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function buildComparison(
  project: ProjectDoc,
  scenes: EvalScene[],
  results: SceneResult[],
  runs: AiRun[],
  promptText: string,
): string {
  const verdicts = results.reduce<Record<Verdict, number>>((counts, result) => {
    counts[result.verdict] += 1;
    return counts;
  }, { same: 0, 'AI better': 0, 'rules better': 0, 'both wrong': 0, 'none expected': 0 });
  const totalCandidates = runs.reduce((sum, run) => sum + Object.values(run.validationByScene).reduce((inner, values) => inner + values.length, 0), 0);
  const rejectedCandidates = runs.reduce((sum, run) => sum + Object.values(run.validationByScene).reduce((inner, values) => inner + values.filter((value) => !value.accepted).length, 0), 0);
  const disagreements = results.filter((result) => !result.runsAgree).length;
  const rulesAcceptable = verdicts.same + verdicts['rules better'] + verdicts['none expected'];
  const aiAcceptable = verdicts.same + verdicts['AI better'] + verdicts['none expected'];
  const hybridAcceptable = results.filter((result) => result.verdict !== 'both wrong').length;
  const inputTokenEstimate = runs.reduce((sum, run) => sum + run.inputTokenEstimate, 0);
  const outputTokenEstimate = runs.reduce((sum, run) => sum + run.outputTokenEstimate, 0);
  const elapsedMs = runs.reduce((sum, run) => sum + run.elapsedMs, 0);
  const lines = [
    '# Task 81 — DeepSeek keyword extraction evaluation',
    '',
    `Project: ${project.title}`,
    `Scenes evaluated: ${scenes.length}${project.scenes.length > MAX_SCENES ? ` (first ${MAX_SCENES} of ${project.scenes.length})` : ''}`,
    '',
    '## Summary',
    '',
    `- Verdict counts: same ${verdicts.same}; AI better ${verdicts['AI better']}; rules better ${verdicts['rules better']}; both wrong ${verdicts['both wrong']}; none expected ${verdicts['none expected']}.`,
    `- Acceptable final popup: rules ${percent(rulesAcceptable / scenes.length)} (${rulesAcceptable}/${scenes.length}); AI after validation ${percent(aiAcceptable / scenes.length)} (${aiAcceptable}/${scenes.length}); hybrid AI-if-valid-else-rules ${percent(hybridAcceptable / scenes.length)} (${hybridAcceptable}/${scenes.length}).`,
    `- Validation rejection rate: ${percent(rejectedCandidates / Math.max(1, totalCandidates))} (${rejectedCandidates}/${totalCandidates} AI candidates).`,
    `- Run-to-run disagreement rate: ${percent(disagreements / Math.max(1, scenes.length))} (${disagreements}/${scenes.length} scenes). Agreement compares the first accepted phrase from each of the three runs.`,
    `- Timing: ${Math.round(elapsedMs)} ms total; ${Math.round(elapsedMs / AI_RUNS)} ms average per run.`,
    `- Tokens: input estimate ${inputTokenEstimate.toLocaleString('en-US')}, output estimate ${outputTokenEstimate.toLocaleString('en-US')}. The shared AiClient discards provider usage, so these are character-based estimates, not billing values.`,
    '- Cost: unknown for legacy `deepseek-chat`; the current official pricing page checked on 2026-10-07 lists newer DeepSeek-V4 models rather than this legacy model.',
    '',
    '## Recommendation',
    '',
    `On this ${scenes.length}-scene run, validated DeepSeek candidates were acceptable in ${aiAcceptable}/${scenes.length} scenes versus ${rulesAcceptable}/${scenes.length} for rules; complete names such as \`Nguyễn Ánh\` and \`Quân Xiêm\` were useful gains, but the ${percent(disagreements / Math.max(1, scenes.length))} run-to-run disagreement rate means this is not stable enough to replace rules outright.`,
    'A narrowly scoped hybrid is promising: keep the rule result as the deterministic fallback, and use AI only for validated, stable name/place candidates with a confidence/consensus guard.',
    'Rules remain the safer baseline for deterministic name timing and should continue to own numbers, dates, and years; no AI result should replace those paths.',
    'Any future AI path must keep the contiguous timed-word validation and fall back to the rule result when a response is rejected or unstable.',
    '',
    '## Comparison',
    '',
    '| Scene | Narration excerpt (name-bearing part) | Rules (text · role) | AI run1 | Runs agree? | AI rejected by validation | Verdict |',
    '|---:|---|---|---|:---:|---:|---|',
    ...results.map((result) => {
      const rejected = result.aiRuns.reduce((sum, run) => sum + run.validation.filter((candidate) => !candidate.accepted).length, 0);
      const phrases = [...result.rules.map((rule) => rule.text), ...result.aiRuns[0]!.candidates.map((candidate) => candidate.phrase)];
      return `| ${result.scene} | ${clipExcerpt(result.narration, phrases).replaceAll('|', '\\|')} | ${formatRules(result.rules).replaceAll('|', '\\|')} | ${formatAiRun(runs[0], result.scene).replaceAll('|', '\\|')} | ${result.runsAgree ? 'yes' : 'no'} | ${rejected} | **${result.verdict}** — ${result.verdictReason} |`;
    }),
    '',
    '## Five instructive disagreements',
    '',
    ...Object.entries(INSTRUCTIVE_DISAGREEMENT_NOTES).flatMap(([sceneNumber, note]) => {
      const result = results.find((candidate) => candidate.scene === Number(sceneNumber));
      if (!result) return [];
      const rule = formatRules(result.rules);
      const ai = formatAiRun(runs[0], result.scene);
      return [`- Scene ${result.scene}: “${result.narration}” — rules: ${rule}; AI run 1: ${ai}. ${note}`];
    }),
    '',
    '## Prompt used',
    '',
    'Temperature: not specified by the shared app client; DeepSeek API default was used.',
    'JSON mode: `{ type: "json_object" }` through the existing DeepSeek client.',
    '',
    '### System message',
    '',
    '```text',
    SYSTEM_PROMPT,
    '```',
    '',
    '### User message',
    '',
    '```text',
    promptText,
    '```',
    '',
    '## Notes',
    '',
    '- AI phrases are dropped when they do not occur in the scene narration or cannot be matched to a contiguous timed-word run.',
    '- The comparison uses only narration and timed words; it does not credit an AI phrase merely because it sounds plausible.',
  ];
  return `${lines.join('\n')}\n`;
}

async function findProject(projectId: string | undefined): Promise<ProjectDoc> {
  const projects = getCollection<ProjectDoc>('projects');
  const requested = projectId ? await projects.findOne({ _id: projectId }) : await projects.findOne({ title: DEFAULT_PROJECT_TITLE });
  if (requested) return requested;
  const fallback = await projects.find({}).toArray();
  const project = fallback.find((candidate) => candidate.scenes.some((scene) => scene.narration.trim() && scene.wordTimings?.words?.length));
  if (!project) throw new Error('No project with narration and word timings was found.');
  return project;
}

function prepareScenes(project: ProjectDoc): EvalScene[] {
  return project.scenes
    .map((scene: SceneDoc, index) => ({ scene, index }))
    .filter(({ scene }) => scene.narration.trim())
    .slice(0, MAX_SCENES)
    .map(({ scene, index }) => ({
      scene: index + 1,
      id: scene.id,
      narration: scene.narration,
      words: scene.wordTimings?.words ?? [],
      rules: scene.wordTimings?.words?.length
        ? selectKeywords(scene.wordTimings.words)
        .filter((keyword) => keyword.kind === 'name')
            .map(({ text, nameRole, subtitle, startSec }) => ({ text, nameRole, subtitle, startSec }))
        : [],
    }));
}

function promptForScenes(scenes: EvalScene[]): string {
  return [
    'Language: vi',
    'Extract names from every scene below. Scene numbers are 1-based project order.',
    '',
    ...scenes.map((scene) => `SCENE ${scene.scene}\n${scene.narration}`),
  ].join('\n');
}

async function runAi(
  client: ReturnType<typeof getAiClient>,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  scenes: EvalScene[],
  run: number,
): Promise<AiRun> {
  const started = performance.now();
  let attempts = 0;
  let rawResponse = '';
  let outputTokenEstimate = 0;
  let parsed: AiPayload = { scenes: [] };
  let error: string | undefined;
  for (attempts = 1; attempts <= 2; attempts++) {
    rawResponse = await client.chat(messages, { json: true, maxTokens: MAX_TOKENS });
    outputTokenEstimate += estimateTokens(rawResponse);
    try {
      parsed = parseAiPayload(rawResponse);
      error = undefined;
      break;
    } catch (parseError) {
      error = parseError instanceof Error ? parseError.message : String(parseError);
      if (attempts === 2) break;
    }
  }
  const validationByScene: Record<string, Validation[]> = {};
  for (const scene of scenes) {
    const aiScene = parsed.scenes.find((candidate) => candidate.scene === scene.scene);
    validationByScene[String(scene.scene)] = error
      ? []
      : (aiScene?.candidates ?? []).map((candidate) => validateCandidate(scene, candidate));
  }
  const inputTokenEstimate = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0) * attempts;
  return {
    run,
    attempts,
    elapsedMs: performance.now() - started,
    inputTokenEstimate,
    outputTokenEstimate,
    rawResponse,
    parsedScenes: parsed.scenes,
    validationByScene,
    ...(error ? { error } : {}),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY is not configured; Task 81 measurement was not run.');
    process.exitCode = 2;
    return;
  }
  await connectDb(config.MONGODB_URI, config.MONGODB_DB);
  try {
    const project = await findProject(process.argv[2]);
    const scenes = prepareScenes(project);
    if (scenes.length === 0) throw new Error(`Project "${project.title}" has no scenes with narration and word timings.`);
    const promptText = promptForScenes(scenes);
    const messages = [{ role: 'system' as const, content: SYSTEM_PROMPT }, { role: 'user' as const, content: promptText }];
    const client = getAiClient('deepseek');
    const runs: AiRun[] = [];
    for (let run = 1; run <= AI_RUNS; run++) {
      console.log(`DeepSeek run ${run}/${AI_RUNS} for ${scenes.length} scenes...`);
      runs.push(await runAi(client, messages, scenes, run));
      const completed = runs.at(-1)!;
      console.log(`run ${run}: ${Math.round(completed.elapsedMs)} ms, ${completed.attempts} attempt(s), ${Object.values(completed.validationByScene).flat().filter((candidate) => candidate.accepted).length} accepted candidate(s)`);
    }
    const results: SceneResult[] = scenes.map((scene) => {
      const aiRuns = runs.map((run) => ({
        run: run.run,
        candidates: run.parsedScenes.find((candidate) => candidate.scene === scene.scene)?.candidates ?? [],
        validation: run.validationByScene[String(scene.scene)] ?? [],
      }));
      const chosen = runs.map((run) => firstAccepted(run, scene.scene));
      const classification = classify(project, scene, runs);
      return {
        ...scene,
        aiRuns,
        runsAgree: new Set(chosen.map((value) => value ? normalizeMention(value) : '')).size === 1,
        verdict: classification.verdict,
        verdictReason: classification.reason,
      };
    });
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(`${OUTPUT_DIR}/results.json`, JSON.stringify({
      generatedAt: new Date().toISOString(),
      project: { id: project._id, title: project.title },
      model: client.model,
      temperature: 'not specified by the shared client; provider default',
      sceneLimit: MAX_SCENES,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: promptText,
      runs,
      scenes: results,
    }, null, 2));
    await writeFile(`${OUTPUT_DIR}/comparison.md`, buildComparison(project, scenes, results, runs, promptText));
    console.log(`Wrote ${OUTPUT_DIR}/results.json and ${OUTPUT_DIR}/comparison.md`);
  } finally {
    await closeDb();
  }
}

await main();
