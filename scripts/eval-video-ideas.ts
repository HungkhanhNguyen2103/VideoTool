import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Document } from 'mongodb';
import { CLAUDE_CLI_DEFAULT_EFFORT } from '../src/contracts/claude-cli';
import { IDEA_DEFAULT_CLI_MODEL, type YoutubeIdeaV2 } from '../src/contracts/youtube-ideas';
import { closeDb, connectDb, getCollection } from '../src/server/db/client';
import { loadConfig } from '../src/server/config';
import { buildYoutubeIdeaRunPacket, computeYoutubeIdeaEvalMetrics, createYoutubeIdeaEvalCallBudget, generateYoutubeVideoIdeas, getYoutubeIdeas, YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS } from '../src/server/modules/youtube';
import type { YoutubeIdeaPipelineResult } from '../src/server/modules/youtube/idea-engine';

const DEMO_CHANNEL_ID = 'youtube-demo-growth-2-20261022';
const REPORT_DIR = 'data/files/.verification/task-121c';
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

function markdownTable(rows: Array<Record<string, string | number | boolean>>): string {
  if (!rows.length) return '_No evaluation runs completed._';
  const columns = Object.keys(rows[0]!);
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => String(row[column] ?? '')).join(' | ')} |`),
  ].join('\n');
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error ?? 'unknown error');
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
}

function isSessionLimit(error: unknown): boolean {
  return /(?:session|usage|rate|weekly|monthly).{0,30}limit|limit.{0,30}(?:session|usage|rate)/iu.test(errorText(error));
}

type EvalRow = {
  steering: string;
  run: number;
  status: 'complete' | 'partial' | 'failed';
  failure: string | null;
  wallMs: number;
  cliCalls: number;
  result: ReturnType<typeof computeYoutubeIdeaEvalMetrics>;
  auditPaths: string[];
};

async function main() {
  const target = requireSafeTarget();
  const steerings = selectedSteerings();
  const runsPerSteering = Number(process.env.YOUTUBE_IDEA_EVAL_RUNS ?? 1);
  if (runsPerSteering !== 1) {
    throw new Error('Task 121c acceptance allows exactly one run per steering per measurement; set YOUTUBE_IDEA_EVAL_RUNS=1.');
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
  console.log(`[guard] Claude argv: --model ${IDEA_DEFAULT_CLI_MODEL} --effort ${CLAUDE_CLI_DEFAULT_EFFORT}`);

  const reportPath = resolve(REPORT_DIR, `eval-${new Date().toISOString().replace(/[:.]/gu, '-')}.md`);
  const runRows: EvalRow[] = [];
  await mkdir(REPORT_DIR, { recursive: true });
  const callBudgetPath = resolve(REPORT_DIR, 'acceptance-cli-call-budget.json');
  const resetBudget = process.env.YOUTUBE_IDEA_EVAL_RESET_CALL_BUDGET === '1';
  let callsAlreadyUsed = 0;
  if (!resetBudget) {
    try {
      const savedBudget = JSON.parse(await readFile(callBudgetPath, 'utf8')) as { callsUsed?: unknown };
      if (Number.isInteger(savedBudget.callsUsed) && Number(savedBudget.callsUsed) >= 0) callsAlreadyUsed = Number(savedBudget.callsUsed);
      else throw new Error('Invalid persisted CLI call budget state.');
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  const callBudget = createYoutubeIdeaEvalCallBudget(callsAlreadyUsed);
  await writeFile(callBudgetPath, `${JSON.stringify({ callsUsed: callBudget.used, limit: YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS }, null, 2)}\n`, 'utf8');
  let sessionLimitHit = false;
  let callBudgetHit = false;
  for (const steering of steerings) {
    for (let runIndex = 1; runIndex <= runsPerSteering; runIndex += 1) {
      const request = { backend: 'cli' as const, cliModel: IDEA_DEFAULT_CLI_MODEL, steering, presetId: 'hubris-trap' as const, count: 6, targetDurationSec: 600 };
      const { packet } = await buildYoutubeIdeaRunPacket(DEMO_CHANNEL_ID, request);
      const logs: string[] = [];
      const callsAtRunStart = callBudget.used;
      let progressPayload: unknown;
      let generated: Awaited<ReturnType<typeof generateYoutubeVideoIdeas>>;
      let failure: unknown = null;
      console.log(`\n[eval] steering=${steering} run=${runIndex}/${runsPerSteering} model=${IDEA_DEFAULT_CLI_MODEL} effort=${CLAUDE_CLI_DEFAULT_EFFORT}`);
      const wallStarted = Date.now();
      try {
        generated = await generateYoutubeVideoIdeas({
          profileId: DEMO_CHANNEL_ID,
          request,
          config,
          context: {
            reportProgress: async (_percent, result) => {
              if (!result || typeof result !== 'object') return;
              progressPayload = result;
              console.log(`[progress] ${JSON.stringify(result)}`);
            },
            isCancelled: async () => false,
            appendLog: async (message) => {
              if (message.includes(': gửi yêu cầu (')) {
                if (!callBudget.claim()) {
                  callBudgetHit = true;
                  throw new Error(`EVAL_CLI_CALL_BUDGET_EXHAUSTED: đã dùng ${callBudget.used}/${YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS} lệnh gọi.`);
                }
                await writeFile(callBudgetPath, `${JSON.stringify({ callsUsed: callBudget.used, limit: YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS }, null, 2)}\n`, 'utf8');
                console.log(`[call-budget] ${callBudget.used}/${YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS}`);
              }
              logs.push(message);
              console.log(`[log] ${message}`);
            },
          },
        });
      } catch (error) {
        generated = undefined;
        failure = error;
        console.error(`[eval] run failed: ${errorText(error)}`);
      }
      const wallMs = Date.now() - wallStarted;
      const auditPaths = logs.flatMap((line) => [...line.matchAll(/audit folder (.+?)(?:\.|$)/gu)].map((match) => match[1] ?? '')).filter(Boolean);
      const payload = progressPayload && typeof progressPayload === 'object' ? progressPayload as Record<string, unknown> : {};
      const progressDiagnostics = payload.diagnostics as YoutubeIdeaPipelineResult['diagnostics'] | undefined;
      const progressDropped = Array.isArray(payload.droppedRows) ? payload.droppedRows as Array<{ id: string; reason: string }> : [];
      let status: EvalRow['status'] = 'failed';
      let ideas: YoutubeIdeaV2[] = [];
      let dropped = progressDropped;
      let repairCalls = progressDiagnostics?.repairCalls ?? { seeds: 0, select: 0, expand: 0 };
      let durations = (payload.durations as YoutubeIdeaPipelineResult['durations'] | undefined) ?? { seedsMs: 0, selectMs: 0, expandMs: 0, totalMs: wallMs };
      let diagnostics = progressDiagnostics;
      if (generated) {
        const saved = await getYoutubeIdeas(DEMO_CHANNEL_ID);
        ideas = saved.ideas.filter((row) => row.runId === generated!.runId).map((row) => row.idea).filter((idea): idea is YoutubeIdeaV2 => 'claims' in idea && 'trap' in idea);
        const runSummary = saved.latestRun;
        if (!runSummary || runSummary.id !== generated.runId) throw new Error(`Could not read run metadata for ${generated.runId}.`);
        status = generated.status;
        dropped = runSummary.dropped;
        repairCalls = generated.repairCalls;
        durations = 'seedsMs' in runSummary.durations ? runSummary.durations : durations;
        diagnostics = generated.diagnostics;
      }
      const result = computeYoutubeIdeaEvalMetrics({ ideas, dropped, packetJson: packet.serialized, repairCalls, durations, ...(diagnostics ? { diagnostics } : {}) });
      const row: EvalRow = { steering, run: runIndex, status, failure: failure ? `${errorCode(failure) ?? 'ERROR'}: ${errorText(failure)}` : null, wallMs, cliCalls: callBudget.used - callsAtRunStart, result, auditPaths };
      runRows.push(row);

      if (generated) {
        await getCollection('youtubeVideoIdeas').deleteMany({ channelProfileId: DEMO_CHANNEL_ID, runId: generated.runId });
        await getCollection<Document & { _id: string; channelProfileId: string }>('youtubeIdeaRuns').deleteOne({ _id: generated.runId, channelProfileId: DEMO_CHANNEL_ID });
        console.log(`[eval] removed generated records for ${generated.runId}; next sample uses the same clean demo coverage.`);
      }
      const table = markdownTable(runRows.map(({ steering: runSteering, run, status: runStatus, wallMs: wall, cliCalls, result: metrics }) => ({
        steering: runSteering, run, status: runStatus, kept: metrics.kept, dropped: metrics.dropped,
        cliCalls,
        funnel: metrics.funnel ? `${metrics.funnel.seeds} → ${metrics.funnel.shortlisted} → ${metrics.funnel.expanded} → ${metrics.funnel.valid}` : 'unavailable',
        archetypes: metrics.distinctHunterArchetypes, centuries: metrics.distinctCenturies,
        famous: metrics.famousnessFamousCount, unbacked: metrics.unbackedNumbers.length + metrics.unbackedNames.length,
        repairs: `${metrics.repairCalls.seeds}/${metrics.repairCalls.select}/${metrics.repairCalls.expand}`,
        rescued: metrics.repairRescues, budgetStopped: metrics.budgetStopped, 'wall time': formatMs(wall),
      })));
      const report = [
        '# Task 121c — Next-video idea eval', '',
        `Database: \`${target.database}\` (localhost + \`youtube_demo_\` verified before connection).`,
        `Demo channel: \`${DEMO_CHANNEL_ID}\` (2 mature videos). Claude argv: \`--model ${IDEA_DEFAULT_CLI_MODEL} --effort ${CLAUDE_CLI_DEFAULT_EFFORT}\`.`,
        `Acceptance CLI budget: ${callBudget.used}/${YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS} calls used across measurements.`,
        '', '## Metrics', '', table, '', '## Run details', '',
        ...runRows.flatMap(({ steering: runSteering, run, status: runStatus, failure: runFailure, wallMs: wall, result: metrics, auditPaths: paths }) => [
          `### ${runSteering} · run ${run} · ${runStatus}`, '',
          ...(runFailure ? [`Error: ${runFailure}`] : []),
          `Outer wall time: ${formatMs(wall)}. Funnel (seeds → shortlist → expanded → valid): ${metrics.funnel ? `${metrics.funnel.seeds} → ${metrics.funnel.shortlisted} → ${metrics.funnel.expanded} → ${metrics.funnel.valid}` : 'not emitted'}.`,
          `Batch details: ${JSON.stringify(metrics.expansionBatches)}. Budget stopped: ${metrics.budgetStopped}.`,
          `Drop reasons: \`${JSON.stringify(metrics.droppedReasonCounts)}\`.`,
          `Repair calls (seeds/select/expand): ${metrics.repairCalls.seeds}/${metrics.repairCalls.select}/${metrics.repairCalls.expand}; repaired survivors: ${metrics.repairRescues}.`,
          `Unbacked numbers: ${JSON.stringify(metrics.unbackedNumbers)}. Unbacked names: ${JSON.stringify(metrics.unbackedNames)}.`,
          `Audit folders: ${paths.length ? paths.map((path) => `\`${path}\``).join(', ') : '_not present in captured logs_'}.`, '',
          ...metrics.titles.flatMap((title) => [`- **${title.title}**`, `  - ${title.trapSketch}`]), '',
        ]),
      ].join('\n');
      await writeFile(reportPath, `${report}\n`, 'utf8');
      console.log(`[eval] summary=${reportPath}`);
      console.log(`[metrics] ${JSON.stringify({ steering, run: runIndex, status, wallMs, failure: row.failure, ...result })}`);
      if (failure && isSessionLimit(failure)) { sessionLimitHit = true; break; }
      if (callBudgetHit) break;
    }
    if (sessionLimitHit || callBudgetHit) break;
  }
  console.log(`\n[eval] completed ${runRows.length} runs; report=${reportPath}`);
  console.log(`[eval] Claude CLI budget used: ${callBudget.used}/${YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS}.`);
  if (sessionLimitHit) console.error('[eval] Claude CLI reported a session or usage limit; remaining runs were not started.');
  if (sessionLimitHit || callBudgetHit) {
    const pending = steerings.filter((steering) => !runRows.some((row) => row.steering === steering && row.status !== 'failed'));
    const targetFor = (steering: string) => steering === STEERINGS[0] ? 'vietnam' : 'world';
    if (pending.length) {
      console.error('[eval] PowerShell commands for remaining steering(s); keep the persisted call-budget file and do not reset it:');
      for (const steering of pending) {
        console.error(`$env:YOUTUBE_IDEA_EVAL_TARGET = '${targetFor(steering)}'`);
        console.error('$env:YOUTUBE_IDEA_EVAL_RUNS = "1"');
        console.error('npx tsx scripts/eval-video-ideas.ts');
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(`[eval] failed before or outside a run: ${errorText(error)}`);
  process.exitCode = 1;
}).finally(() => closeDb());
