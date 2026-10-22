export type SeoGenerationStep = { index: number; total: number; name: string };
export type TimestampedSeoGenerationLog = { text: string; receivedAt: number };
export type SeoGenerationLiveness = { noSignalSeconds: number | null; slowStep: boolean };

const NO_SIGNAL_AFTER_MS = 45_000;
const SLOW_STEP_AFTER_MS = 3 * 60_000;

export function parseSeoGenerationStep(line: string): SeoGenerationStep | null {
  const match = /^Bước (\d+)\/(\d+) — ([^:]+):/.exec(line);
  if (!match) return null;
  return { index: Number(match[1]), total: Number(match[2]), name: match[3]!.trim() };
}

export function deriveSeoGenerationStep(logs: readonly string[]): SeoGenerationStep | null {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const step = parseSeoGenerationStep(logs[index]!);
    if (step) return step;
  }
  return null;
}

export function formatSeoElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function getSeoGenerationLiveness(input: {
  active: boolean;
  now: number;
  lastEventAt: number | null;
  stepStartedAt: number | null;
}): SeoGenerationLiveness {
  if (!input.active) return { noSignalSeconds: null, slowStep: false };
  const noSignalMs = input.lastEventAt === null ? null : Math.max(0, input.now - input.lastEventAt);
  const stepElapsedMs = input.stepStartedAt === null ? 0 : Math.max(0, input.now - input.stepStartedAt);
  return {
    noSignalSeconds: noSignalMs !== null && noSignalMs > NO_SIGNAL_AFTER_MS ? Math.floor(noSignalMs / 1_000) : null,
    slowStep: stepElapsedMs > SLOW_STEP_AFTER_MS,
  };
}

export function getSeoGenerationStepStartAt(logs: readonly TimestampedSeoGenerationLog[]): number | null {
  let activeStep = '';
  let startedAt: number | null = null;
  for (const log of logs) {
    const step = parseSeoGenerationStep(log.text);
    if (!step) continue;
    const identity = `${step.index}/${step.total}/${step.name}`;
    if (log.text.includes(': gửi yêu cầu (')) {
      if (activeStep !== identity) {
        activeStep = identity;
        startedAt = log.receivedAt;
      }
      continue;
    }
    if ((log.text.includes(': xong.') || log.text.includes(': thất bại —')) && activeStep === identity) {
      activeStep = '';
      startedAt = null;
    }
  }
  return startedAt;
}

export function windowSeoGenerationLogs(logs: readonly string[], limit = 10): string[] {
  return logs.slice(-Math.max(0, Math.floor(limit)));
}
