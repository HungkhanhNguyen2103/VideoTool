import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeepSeekClient } from './deepseek';

describe('DeepSeek HTTP request', () => {
  const previousApiKey = process.env.DEEPSEEK_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousApiKey;
  });

  it('serializes the explicit zero temperature into the provider request body', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const sentBodies: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBodies.push(String(init?.body));
      const completion = {
        id: 'fake-completion', object: 'chat.completion', created: 1, model: 'deepseek-chat',
        choices: [{ index: 0, message: { role: 'assistant', content: '{"scenes":[]}' }, finish_reason: 'stop' }],
      };
      return new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDeepSeekClient().chat([{ role: 'system', content: 'test' }], { json: true, maxTokens: 8_000, temperature: 0 });

    const sentBody = JSON.parse(sentBodies[0]!) as Record<string, unknown>;
    expect(sentBody).toMatchObject({ model: 'deepseek-chat', temperature: 0, max_tokens: 8_000, response_format: { type: 'json_object' } });
  });
});
