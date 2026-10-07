import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectDb, closeDb, getCollection } from '../src/server/db/client';
import { loadConfig } from '../src/server/config';
import { ProjectDocSchema, type ProjectDoc } from '../src/server/modules/project/docs';
import { createFreesoundClient } from '../src/server/shared/freesound/client';
import { extractSearchQueries, normalizeKeyword } from '../src/server/shared/freesound/keyword-map';

type RoundName = 'default-1.1s' | 'slow-1.2s';
type TopResult = { id?: number; name?: string; tags?: string[]; duration?: number; avg_rating?: number; num_ratings?: number };
type SearchRecord = {
  round: RoundName;
  sceneNumber: number;
  kind: 'search' | 'download';
  query: string;
  status: number;
  latencyMs: number;
  resultCount: number | null;
  top: TopResult | null;
  at: number;
};
type SceneRecord = {
  sceneNumber: number;
  prompt: string;
  queries: string[];
  outcome: string;
  chosen: TopResult | null;
};

const SEARCH_HOST = 'freesound.org';
const VIETNAMESE = /[\u00c0-\u024f]/u;
const VOICE_TAG = /\b(?:speech|voice|vocal|shout|scream|yell|crowd|chant|sing|talk|narrat|human|war[- ]?cry)\b/i;
const LEGACY_KEYWORD_MAP: Record<string, string> = {
  'tiếng tích tắc đồng hồ': 'clock ticking', 'đồng hồ': 'clock ticking', 'tích tắc': 'clock ticking',
  'tiếng lật trang sách': 'page turn flip', 'lật sách': 'page turn', 'tiếng chuông': 'bell chime',
  'tiếng gõ phím': 'typing keyboard', 'tiếng súng': 'gunshot', 'tiếng bước chân': 'footsteps',
  'tiếng gió': 'wind blowing', 'tiếng mưa': 'rain falling', 'tiếng tiền rơi': 'coins drop',
  'tiếng cười': 'laughing', 'tiếng thở dài': 'sigh', 'đóng tài liệu': 'paper folder close', 'tiếng kịch tính': 'dramatic sting hit',
};

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function oldAsciiNormalize(term: string): string {
  const lower = term.toLowerCase().trim();
  const mapped = Object.entries(LEGACY_KEYWORD_MAP).find(([vietnamese]) => lower.includes(vietnamese))?.[1];
  if (mapped) return mapped;
  return lower
    .replace(/^tiếng\s+/i, '')
    .replace(/\b(sfx|sound effect|sound|value)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function makeClient(round: RoundName, records: SearchRecord[]) {
  let lastApiRequestAt = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const isApiSearch = url.hostname === SEARCH_HOST && url.pathname.startsWith('/apiv2/search/');
    if (isApiSearch && round === 'slow-1.2s' && lastApiRequestAt > 0) {
      const remaining = 1200 - (Date.now() - lastApiRequestAt);
      if (remaining > 0) await pause(remaining);
    }
    const startedAt = Date.now();
    const response = await fetch(input, init);
    const isPreviewDownload = /(?:^|\.)freesound\.(?:org|com)$/i.test(url.hostname) && !isApiSearch;
    if (isApiSearch || isPreviewDownload) {
      lastApiRequestAt = Date.now();
      let resultCount: number | null = null;
      let top: TopResult | null = null;
      if (response.ok) {
        try {
          const payload = await response.clone().json() as { results?: unknown };
          const results = Array.isArray(payload.results) ? payload.results : [];
          resultCount = results.length;
          const first = results[0];
          if (first && typeof first === 'object') {
            const candidate = first as Record<string, unknown>;
            top = {
              ...(typeof candidate.id === 'number' ? { id: candidate.id } : {}),
              ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
              ...(Array.isArray(candidate.tags) ? { tags: candidate.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
              ...(typeof candidate.duration === 'number' ? { duration: candidate.duration } : {}),
              ...(typeof candidate.avg_rating === 'number' ? { avg_rating: candidate.avg_rating } : {}),
              ...(typeof candidate.num_ratings === 'number' ? { num_ratings: candidate.num_ratings } : {}),
            };
          }
        } catch {
          // Preserve the actual response for the production client; just report an unparsed count.
        }
      }
      records.push({
        round,
        sceneNumber: activeSceneNumber,
        kind: isApiSearch ? 'search' : 'download',
        query: isApiSearch ? url.searchParams.get('query') ?? '' : 'preview download',
        status: response.status,
        latencyMs: Date.now() - startedAt,
        resultCount,
        top,
        at: Date.now(),
      });
    }
    return response;
  };
  return createFreesoundClient({ apiKey: config.FREESOUND_API_KEY, fetchImpl });
}

let activeSceneNumber = 0;
const config = loadConfig();

function requestsPerMinute(records: SearchRecord[]): string {
  if (records.length < 2) return records.length === 1 ? 'n/a (one API request)' : '0';
  const elapsedSeconds = Math.max(0.001, (records.at(-1)!.at - records[0]!.at) / 1000);
  return ((records.length / elapsedSeconds) * 60).toFixed(1);
}

async function runRound(project: ProjectDoc, round: RoundName): Promise<{ scenes: SceneRecord[]; searches: SearchRecord[] }> {
  const searches: SearchRecord[] = [];
  const client = makeClient(round, searches);
  const scenes: SceneRecord[] = [];
  for (const [index, scene] of project.scenes.entries()) {
    activeSceneNumber = index + 1;
    const queries = extractSearchQueries(scene.sfxPrompt);
    if (!scene.sfxPrompt.trim()) {
      scenes.push({ sceneNumber: index + 1, prompt: '', queries, outcome: 'no-prompt', chosen: null });
      continue;
    }
    const result = await client.searchSfx(scene.sfxPrompt);
    scenes.push({
      sceneNumber: index + 1,
      prompt: scene.sfxPrompt,
      queries,
      outcome: result.reason,
      chosen: result.sound ? {
        id: result.sound.id, name: result.sound.name, tags: result.sound.tags, duration: result.sound.duration,
        avg_rating: result.sound.avg_rating, num_ratings: result.sound.num_ratings,
      } : null,
    });
  }
  return { scenes, searches };
}

function reportRound(label: RoundName, round: { scenes: SceneRecord[]; searches: SearchRecord[] }): string[] {
  const counts = new Map<string, number>();
  for (const scene of round.scenes) counts.set(scene.outcome, (counts.get(scene.outcome) ?? 0) + 1);
  const apiSearches = round.searches.filter((record) => record.kind === 'search');
  const previewDownloads = round.searches.filter((record) => record.kind === 'download');
  const voiceTops = apiSearches.filter((record) => record.top && VOICE_TAG.test(`${record.top.name ?? ''} ${(record.top.tags ?? []).join(' ')}`)).length;
  const countSummary = [...counts.entries()].map(([name, count]) => `${name}: ${count}`).join(', ') || 'none';
  const lines = [
    `## ${label}`,
    '',
    `- Scene outcomes: ${countSummary}`,
    `- API search requests: ${apiSearches.length}; preview download requests: ${previewDownloads.length}; all Freesound requests: ${round.searches.length}; API requests/minute: ${requestsPerMinute(apiSearches)}`,
    `- First-ranked results tagged speech/voice/shout/crowd/scream: ${voiceTops}/${apiSearches.length}`,
    '',
    '| Scene | sfxPrompt | Queries | HTTP status / ms / result count / top result | Outcome |',
    '|---:|---|---|---|---|',
  ];
  for (const scene of round.scenes) {
    const reqs = round.searches.filter((item) => item.sceneNumber === scene.sceneNumber)
      .map((item) => `${item.kind === 'search' ? `search ${item.status} / ${item.latencyMs}ms / ${item.resultCount ?? 'unreadable'} results / top ${item.top ? `${item.top.name ?? '—'}; tags ${(item.top.tags ?? []).join(', ')}; ${item.top.duration ?? '?'}s; rating ${item.top.avg_rating ?? '?'}` : '—'}` : `preview download ${item.status} / ${item.latencyMs}ms`}`)
      .join('<br>') || 'no search request';
    const chosen = scene.chosen ? `; chosen #${scene.chosen.id} ${scene.chosen.name}; tags ${(scene.chosen.tags ?? []).join(', ')}; ${scene.chosen.duration}s; rating ${scene.chosen.avg_rating}` : '';
    lines.push(`| ${scene.sceneNumber} | ${escapeCell(scene.prompt)} | ${escapeCell(scene.queries.join('; '))} | ${escapeCell(reqs)} | ${scene.outcome}${escapeCell(chosen)} |`);
  }
  return lines;
}

async function main(): Promise<void> {
  if (!config.FREESOUND_API_KEY) throw new Error('FREESOUND_API_KEY is empty; no API request was made.');
  await connectDb(config.MONGODB_URI, config.MONGODB_DB);
  try {
    const raw = await getCollection<ProjectDoc>('projects').find({ title: /Rạch Gầm/i }).sort({ updatedAt: -1 }).next();
    if (!raw) throw new Error('Could not find the Rạch Gầm project in MongoDB.');
    const project = ProjectDocSchema.parse(raw);
    const vietnamesePrompts = project.scenes.filter((scene) => VIETNAMESE.test(scene.sfxPrompt));
    const garbledBefore = vietnamesePrompts.filter((scene) => scene.sfxPrompt.split(/[,;\n|]+/u).some((part) => VIETNAMESE.test(part) && oldAsciiNormalize(part).length > 0)).length;
    const unmappedNow = vietnamesePrompts.filter((scene) => scene.sfxPrompt.split(/[,;\n|]+/u).some((part) => VIETNAMESE.test(part) && normalizeKeyword(part) === '')).length;
    const first = await runRound(project, 'default-1.1s');
    const second = await runRound(project, 'slow-1.2s');
    const firstByScene = new Map(first.scenes.map((scene) => [scene.sceneNumber, scene.outcome]));
    const changed = second.scenes.filter((scene) => firstByScene.get(scene.sceneNumber) !== scene.outcome).length;
    const report = [
      '# Task 85 Freesound diagnosis',
      '',
      `Project: ${project.title} (${project.scenes.length} scenes; ${project.scenes.filter((scene) => scene.sfxPrompt.trim()).length} with SFX prompts). No project or file records were modified.`,
      '',
      `- Vietnamese-containing prompts: ${vietnamesePrompts.length}. The prior ASCII-stripping normalizer would garble ${garbledBefore}; current map/skip behavior leaves ${unmappedNow} scene prompts with at least one unmapped Vietnamese phrase (not sent as malformed queries).`,
      `- Outcome changes between default pacing and an extra 1.2-second API request spacing: ${changed}/${Math.min(first.scenes.length, second.scenes.length)} prompted scenes.`,
      '- This compares the post-change default limiter with slower pacing; it is not a captured pre-change baseline.',
      '',
      ...reportRound('default-1.1s', first),
      '',
      ...reportRound('slow-1.2s', second),
      '',
    ].join('\n');
    const outputDir = path.resolve('data/files/.verification/task-85');
    await mkdir(outputDir, { recursive: true });
    const output = path.join(outputDir, 'sfx-diagnosis.md');
    await writeFile(output, report, { flag: 'wx' });
    console.log(`Wrote read-only diagnosis to ${output}`);
  } finally {
    await closeDb();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`SFX diagnosis failed: ${message}`);
  process.exitCode = 1;
});
