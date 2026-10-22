import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Document } from 'mongodb';
import { IDEA_DEFAULT_CLI_MODEL, type YoutubeIdeaV2 } from '../src/contracts/youtube-ideas';
import { closeDb, connectDb, getCollection } from '../src/server/db/client';
import { loadConfig } from '../src/server/config';
import { buildYoutubeIdeaRunPacket, computeYoutubeIdeaEvalMetrics, generateYoutubeVideoIdeas, getYoutubeIdeas } from '../src/server/modules/youtube';

const DEMO_CHANNEL_ID = 'youtube-demo-growth-2-20261022';
const REPORT_DIR = 'data/files/.verification/task-121';
const STEERINGS = [
  'lịch sử Việt Nam, ít người biết, hubris-trap',
  'lịch sử thế giới (quân sự, kinh tế, công nghệ), hubris-trap',
] as const;

function selectedSteerings(): readonly string[] {
  const target = process.env.YOUTUBE_IDEA_EVAL_TARGET;
  if (!target || target === 'both') return STEERINGS;
  if (target === 'vietnam') return [STEERINGS[0]];
  if (target === 'world') return [STEERINGS[1]];
  throw new Error('YOUTUBE_IDEA_EVAL_TARGET must be both, vietnam or world.');
}

function requireSafeTarget(): { uri: string; database: string } {
  const uri = process.env.YOUTUBE_SEED_MONGODB_URI;
  const database = process.env.YOUTUBE_SEED_MONGODB_DB;
  if (!uri || !database) throw new Error('Set YOUTUBE_SEED_MONGODB_URI and YOUTUBE_SEED_MONGODB_DB for an isolated local demo database.');
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error('Refusing to run: YOUTUBE_SEED_MONGODB_URI is not a valid MongoDB URI.'); }
  const hostname = parsed.hostname.replace(/^\[|\]$/gu, '').toLocaleLowerCase('en-US');
  if (parsed.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '::1'].includes(hostname) || !database.startsWith('youtube_demo_')) {
    throw new Error('Refusing to run: use localhost MongoDB and a database name that starts with youtube_demo_.');
  }
  return { uri, database };
}

async function configuredDatabaseFromEnvFile(): Promise<string | null> {
  try {
    const content = await readFile('.env', 'utf8');
    const line = content.split(/\r?\n/u).find((entry) => /^\s*MONGODB_DB\s*=/u.test(entry));
    if (!line) return null;
    return (line.slice(line.indexOf('=') + 1).trim().replace(/^(?:"([^"]*)"|'([^']*)')$/u, (_whole, doubleQuoted: string | undefined, singleQuoted: string | undefined) => doubleQuoted ?? singleQuoted ?? '') || null);
  } catch {
    return null;
  }
}

function formatMs(value: number): string {
  return `${(value / 1000).toFixed(1)}s`;
}

function markdownTable(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return '_No evaluation runs completed._';
  const columns = Object.keys(rows[0]!);
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => String(row[column] ?? '')).join(' | ')} |`),
  ].join('\n');
}

async function main() {
  // The isolated target check must complete before config parsing or any DB connection.
  const target = requireSafeTarget();
  const steerings = selectedSteerings();
  const runsPerSteering = Number(process.env.YOUTUBE_IDEA_EVAL_RUNS ?? 3);
  if (!Number.isInteger(runsPerSteering) || runsPerSteering < 1 || runsPerSteering > 10) {
    throw new Error('YOUTUBE_IDEA_EVAL_RUNS must be an integer from 1 to 10.');
  }
  const appConfig = loadConfig(process.env);
  const configuredDatabase = await configuredDatabaseFromEnvFile();
  if (target.database === appConfig.MONGODB_DB || target.database === configuredDatabase) {
    throw new Error('Refusing to run: the explicit eval database matches the configured application database. Choose a separate youtube_demo_ database.');
  }
  console.log(`[guard] Isolated localhost database verified: ${target.database}`);
  await connectDb(target.uri, target.database);
  const config = { ...appConfig, MONGODB_URI: target.uri, MONGODB_DB: target.database };
  const initial = await getYoutubeIdeas(DEMO_CHANNEL_ID);
  if (initial.matureVideoCount !== 2) {
    throw new Error(`Expected the seeded 2-video demo channel ${DEMO_CHANNEL_ID}; found ${initial.matureVideoCount} mature videos. Run scripts/seed-youtube-analytics-demo.ts against this isolated database first.`);
  }
  console.log(`[guard] Demo channel verified: ${DEMO_CHANNEL_ID}, mature videos=${initial.matureVideoCount}.`);

  const reportPath = resolve(REPORT_DIR, `eval-${new Date().toISOString().replace(/[:.]/gu, '-')}.md`);
  const runRows: Array<{ steering: string; run: number; result: Awaited<ReturnType<typeof computeYoutubeIdeaEvalMetrics>>; auditPaths: string[] }> = [];
  for (const steering of steerings) {
    for (let runIndex = 1; runIndex <= runsPerSteering; runIndex += 1) {
      const request = { backend: 'cli' as const, cliModel: IDEA_DEFAULT_CLI_MODEL, steering, presetId: 'hubris-trap' as const, count: 6, targetDurationSec: 600 };
      const { packet } = await buildYoutubeIdeaRunPacket(DEMO_CHANNEL_ID, request);
      const logs: string[] = [];
      console.log(`\n[eval] steering=${steering} run=${runIndex}/${runsPerSteering} model=${IDEA_DEFAULT_CLI_MODEL}`);
      const generated = await generateYoutubeVideoIdeas({
        profileId: DEMO_CHANNEL_ID,
        request,
        config,
        context: {
          reportProgress: async (_percent, result) => { if (result) console.log(`[progress] ${JSON.stringify(result)}`); },
          isCancelled: async () => false,
          appendLog: async (message) => { logs.push(message); console.log(`[log] ${message}`); },
        },
      });
      if (!generated) throw new Error(`Run ${runIndex} returned no saved result.`);
      const saved = await getYoutubeIdeas(DEMO_CHANNEL_ID);
      const currentRunIdeas = saved.ideas.filter((row) => row.runId === generated.runId).map((row) => row.idea);
      if (!currentRunIdeas.every((idea): idea is YoutubeIdeaV2 => 'claims' in idea && 'trap' in idea)) {
        throw new Error(`Run ${generated.runId} contains a non-v2 idea.`);
      }
      const runSummary = saved.latestRun;
      if (!runSummary || runSummary.id !== generated.runId || !('seedsMs' in runSummary.durations)) {
        throw new Error(`Could not read v2 run metadata for ${generated.runId}.`);
      }
      const result = computeYoutubeIdeaEvalMetrics({
        ideas: currentRunIdeas,
        dropped: runSummary.dropped,
        packetJson: packet.serialized,
        repairCalls: generated.repairCalls,
        durations: runSummary.durations,
      });
      const auditPaths = logs.flatMap((line) => [...line.matchAll(/audit folder (.+?)(?:\.|$)/gu)].map((match) => match[1] ?? '')).filter(Boolean);
      runRows.push({ steering, run: runIndex, result, auditPaths });
      const table = markdownTable(runRows.map(({ steering: runSteering, run, result: metrics }) => ({
        steering: runSteering, run, kept: metrics.kept, dropped: metrics.dropped,
        'blind spot ≥ partial': `${metrics.blindSpotAtLeastPartial}/${metrics.kept}`,
        archetypes: metrics.distinctHunterArchetypes, centuries: metrics.distinctCenturies,
        famous: metrics.famousnessFamousCount, claims: metrics.claims,
        'low claims': `${metrics.lowConfidenceClaims}/${metrics.claims}`, 'low share': metrics.lowConfidenceShare.toFixed(2),
        'unbacked numbers': metrics.unbackedNumbers.length, 'unbacked names': metrics.unbackedNames.length,
        repairs: `${metrics.repairCalls.seeds}/${metrics.repairCalls.select}/${metrics.repairCalls.expand}`,
        time: formatMs(metrics.durations.totalMs),
      })));
      const report = [
        '# Task 121 — Next-video idea eval',
        '',
        `Database: \`${target.database}\` (verified localhost + \`youtube_demo_\` prefix before connection).`,
        `Demo channel: \`${DEMO_CHANNEL_ID}\` (2 mature videos). Model: \`${IDEA_DEFAULT_CLI_MODEL}\`.`,
        '',
        '## Metrics',
        '',
        table,
        '',
        '## Run details',
        '',
        ...runRows.flatMap(({ steering: runSteering, run, result: metrics, auditPaths }) => [
          `### ${runSteering} · run ${run}`,
          '',
          `Dropped reasons: \`${JSON.stringify(metrics.droppedReasonCounts)}\`.`,
          `Stage durations: seeds ${formatMs(metrics.durations.seedsMs)}, select ${formatMs(metrics.durations.selectMs)}, expand ${formatMs(metrics.durations.expandMs)}, total ${formatMs(metrics.durations.totalMs)}.`,
          `Repair calls (seeds/select/expand): ${metrics.repairCalls.seeds}/${metrics.repairCalls.select}/${metrics.repairCalls.expand}.`,
          `Low-confidence claim share: ${metrics.lowConfidenceShare.toFixed(2)}. Unbacked numbers: ${JSON.stringify(metrics.unbackedNumbers)}. Unbacked names: ${JSON.stringify(metrics.unbackedNames)}.`,
          `Audit folders: ${auditPaths.length ? auditPaths.map((path) => `\`${path}\``).join(', ') : '_not present in captured logs_'}.`,
          '',
          ...metrics.titles.flatMap((row) => [`- **${row.title}**`, `  - ${row.trapSketch}`]),
          '',
        ]),
      ].join('\n');
      await mkdir(REPORT_DIR, { recursive: true });
      await writeFile(reportPath, `${report}\n`, 'utf8');
      console.log(`[eval] summary=${reportPath}`);
      console.log(`[metrics] ${JSON.stringify({ run: runIndex, steering, ...result })}`);
      await getCollection('youtubeVideoIdeas').deleteMany({ channelProfileId: DEMO_CHANNEL_ID, runId: generated.runId });
      await getCollection<Document & { _id: string; channelProfileId: string }>('youtubeIdeaRuns').deleteOne({ _id: generated.runId, channelProfileId: DEMO_CHANNEL_ID });
      console.log(`[eval] removed generated records for ${generated.runId}; next sample uses the same clean demo coverage.`);
    }
  }
  console.log(`\n[eval] completed ${runRows.length} runs; report=${reportPath}`);
}

main().catch((error: unknown) => {
  console.error(`[eval] failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}).finally(() => closeDb());
