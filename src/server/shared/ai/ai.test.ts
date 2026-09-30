import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deepseekCreate: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicStream: vi.fn(),
  deepseekOptions: vi.fn(),
  anthropicOptions: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    constructor(options: unknown) { mocks.deepseekOptions(options); }
    chat = { completions: { create: mocks.deepseekCreate } };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    constructor(options: unknown) { mocks.anthropicOptions(options); }
    messages = { create: mocks.anthropicCreate, stream: mocks.anthropicStream };
  },
}));

import { getAiClient } from './index';
import { createClaudeClient } from './claude';
import { createDeepSeekClient } from './deepseek';

describe('AI client abstraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deepseekCreate.mockResolvedValue({ choices: [{ message: { content: 'deepseek reply' } }] });
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'claude reply' }] });
    mocks.anthropicStream.mockReturnValue((async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'claude ' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'stream' } };
    })());
  });

  it('returns singleton clients for each provider', () => {
    expect(getAiClient('deepseek')).toBe(getAiClient('deepseek'));
    expect(getAiClient('claude')).toBe(getAiClient('claude'));
    expect(getAiClient('deepseek')).not.toBe(getAiClient('claude'));
  });

  it('maps DeepSeek chat and stream deltas to the common interface', async () => {
    const client = getAiClient('deepseek');
    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toBe('deepseek reply');
    mocks.deepseekCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'deep ' } }] };
      yield { choices: [{ delta: { content: 'seek' } }] };
    })());
    await expect((async () => { const values: string[] = []; for await (const value of client.stream([{ role: 'user', content: 'hello' }])) values.push(value); return values; })())
      .resolves.toEqual(['deep ', 'seek']);
  });

  it('sends DeepSeek JSON mode and the requested token limit for JSON chats', async () => {
    const client = createDeepSeekClient();

    await client.chat([{ role: 'user', content: 'Return JSON.' }], { json: true, maxTokens: 4000 });

    expect(mocks.deepseekCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }));
  });

  it('maps Claude text blocks and stream deltas to the common interface', async () => {
    const client = getAiClient('claude');
    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toBe('claude reply');
    const values: string[] = [];
    for await (const value of client.stream([{ role: 'user', content: 'hello' }])) values.push(value);
    expect(values).toEqual(['claude ', 'stream']);
  });

  it('constructs without provider keys', async () => {
    const clients = [getAiClient('deepseek'), getAiClient('claude')];
    expect(clients).toHaveLength(2);
  });

  it('configures both SDK clients with the bounded timeout and one retry', () => {
    const previous = process.env.AI_REQUEST_TIMEOUT_MS;
    process.env.AI_REQUEST_TIMEOUT_MS = '3210';
    try {
      createDeepSeekClient();
      createClaudeClient();
      expect(mocks.deepseekOptions).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 3210, maxRetries: 1, baseURL: 'https://api.deepseek.com' }));
      expect(mocks.anthropicOptions).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 3210, maxRetries: 1 }));
    } finally {
      if (previous === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
      else process.env.AI_REQUEST_TIMEOUT_MS = previous;
    }
  });

  it.each([
    [401, 'DeepSeek API key invalid'],
    [402, 'DeepSeek balance insufficient'],
    [429, 'DeepSeek API rate limited'],
  ])('maps DeepSeek HTTP %s to a readable AppError', async (status, expected) => {
    const client = createDeepSeekClient();
    mocks.deepseekCreate.mockRejectedValueOnce(Object.assign(new Error('secret key sk-test-must-not-leak'), { status }));

    const error = await client.chat([{ role: 'user', content: 'hello' }]).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status, code: 'AI_REQUEST_FAILED' });
    expect((error as Error).message).toContain(expected);
    expect((error as Error).message).not.toContain('sk-test-must-not-leak');
  });

  it('maps DeepSeek timeout and network errors without exposing the key', async () => {
    const client = createDeepSeekClient();
    mocks.deepseekCreate.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo ENOTFOUND api.deepseek.com sk-secret'), { code: 'ENOTFOUND' }));

    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({
      code: 'AI_REQUEST_FAILED',
      message: 'Cannot reach api.deepseek.com (timeout/network).',
    });
  });

  it('fails a never-resolving DeepSeek request within the configured timeout', async () => {
    const previous = process.env.AI_REQUEST_TIMEOUT_MS;
    process.env.AI_REQUEST_TIMEOUT_MS = '20';
    try {
      const client = createDeepSeekClient();
      mocks.deepseekCreate.mockImplementationOnce(() => new Promise<never>(() => undefined));
      await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({
        code: 'AI_REQUEST_FAILED',
        message: 'Cannot reach api.deepseek.com (timeout/network).',
      });
    } finally {
      if (previous === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
      else process.env.AI_REQUEST_TIMEOUT_MS = previous;
    }
  });
});
