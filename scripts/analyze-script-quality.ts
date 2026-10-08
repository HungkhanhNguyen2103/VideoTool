import { loadConfig } from '../src/server/config';
import { closeDb, connectDb } from '../src/server/db/client';
import { getProject } from '../src/server/modules/project';
import { analyzeScriptQuality, formatQualityReport } from '../src/server/modules/script/quality';

function parseArgs(args: string[]): { projectId: string; format: 'md' | 'json' } {
  let format: 'md' | 'json' = 'md';
  let projectId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--format') {
      const value = args[index + 1];
      if (value !== 'md' && value !== 'json') throw new Error('--format must be md or json');
      format = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (projectId === undefined) {
      projectId = arg;
    } else {
      throw new Error('Only one project ID may be supplied');
    }
  }
  if (!projectId) throw new Error('Usage: npm run analyze:script-quality -- <project-id> [--format md|json]');
  return { projectId, format };
}

async function main(): Promise<void> {
  const { projectId, format } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  await connectDb(config.MONGODB_URI, config.MONGODB_DB);
  try {
    const project = await getProject(projectId);
    const report = analyzeScriptQuality(project);
    process.stdout.write(formatQualityReport(report, format));
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
