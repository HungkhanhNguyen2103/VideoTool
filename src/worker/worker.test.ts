import { describe, expect, it, vi } from 'vitest';
import { createWorkerLoop } from './main';

const mocks = vi.hoisted(() => ({ generateScript: vi.fn() }));
vi.mock('../server/modules/script/service', () => ({ generateScript: mocks.generateScript }));
import { jobHandlers } from './registry';

describe('worker poll loop', () => {
  it('recovers each tick and drains until no job remains', async () => {
    let claims = 0;
    let recoveries = 0;
    const loop = createWorkerLoop({
      workerId: 'test-worker',
      handlers: {},
      recover: async () => { recoveries += 1; },
      claimAndRun: async () => { claims += 1; return claims < 3; },
    });
    await loop.tick();
    expect({ claims, recoveries }).toEqual({ claims: 3, recoveries: 1 });
  });

  it('does not overlap ticks', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maxActive = 0;
    const loop = createWorkerLoop({
      workerId: 'test-worker',
      handlers: {},
      recover: async () => undefined,
      claimAndRun: async () => { active += 1; maxActive = Math.max(maxActive, active); await blocked; active -= 1; return false; },
    });
    const first = loop.tick();
    const second = loop.tick();
    release();
    await Promise.all([first, second]);
    expect(maxActive).toBe(1);
  });

  it('checks closing between claims in one drain tick', async () => {
    let claims = 0;
    const loop = createWorkerLoop({
      workerId: 'test-worker',
      handlers: {},
      recover: async () => undefined,
      claimAndRun: async () => { claims += 1; if (claims === 1) loop.stop(); return true; },
    });
    await loop.tick();
    expect(claims).toBe(1);
  });
});

describe('script job registration', () => {
  it('registers generate-script and maps payload/context to the service', async () => {
    mocks.generateScript.mockResolvedValue(undefined);
    const appendLog = vi.fn();
    const isCancelled = vi.fn().mockResolvedValue(false);
    const handler = jobHandlers['generate-script'];
    expect(handler).toBeDefined();
    await handler!({
      _id: 'job-1', schemaVersion: 1, type: 'generate-script', projectId: 'project-1', payload: { projectId: 'project-2' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: false, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled, appendLog });
    expect(mocks.generateScript).toHaveBeenCalledWith('project-2', appendLog);
  });

  it('does not start generation when the job is already cancelled', async () => {
    mocks.generateScript.mockReset();
    const handler = jobHandlers['generate-script']!;
    await handler({
      _id: 'job-2', schemaVersion: 1, type: 'generate-script', projectId: 'project-1', payload: { projectId: 'project-1' },
      status: 'running', attempts: 1, maxAttempts: 3, runAt: new Date(), lockedBy: 'worker', lockedAt: new Date(),
      progress: 0, result: null, error: null, cancelRequested: true, logs: [], createdAt: new Date(), updatedAt: new Date(),
    }, { reportProgress: vi.fn(), isCancelled: vi.fn().mockResolvedValue(true), appendLog: vi.fn() });
    expect(mocks.generateScript).not.toHaveBeenCalled();
  });
});
