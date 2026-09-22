import { describe, expect, it } from 'vitest';
import { createWorkerLoop } from './main';

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
