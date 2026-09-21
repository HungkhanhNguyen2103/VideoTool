import { mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

// These tests need no database: they cover routing, JSON errors and the SPA fallback.
let server: Server | null = null;

async function start(clientDir: string | null): Promise<string> {
  const filesDir = mkdtempSync(path.join(tmpdir(), 'vt-files-'));
  const app = createApp({ filesDir, clientDir });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
});

describe('createApp', () => {
  it('returns a JSON 404 for unknown /api paths', async () => {
    const base = await start(null);
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  it('returns a JSON 400 for malformed JSON bodies', async () => {
    const base = await start(null);
    const res = await fetch(`${base}/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bad_request');
  });

  it('returns 404 for a missing file under /files', async () => {
    const base = await start(null);
    const res = await fetch(`${base}/files/missing.txt`);
    expect(res.status).toBe(404);
  });

  it('serves the SPA fallback only when a client dir is configured, and never for /api', async () => {
    const clientDir = mkdtempSync(path.join(tmpdir(), 'vt-client-'));
    writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>spa</title>');
    const base = await start(clientDir);

    const page = await fetch(`${base}/production/init`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>spa</title>');

    const api = await fetch(`${base}/api/nope`);
    expect(api.status).toBe(404);
    expect((await api.json()).error.code).toBe('not_found');
  });
});
