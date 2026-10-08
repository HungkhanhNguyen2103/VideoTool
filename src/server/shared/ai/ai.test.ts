import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deepseekCreate: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicStream: vi.fn(),
  deepseekOptions: vi.fn(),
  anthropicOptions: vi.fn(),
}));

let previousDeepSeekKey: string | undefined;
let previousAnthropicKey: string | undefined;

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
    previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
    previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    vi.clearAllMocks();
    mocks.deepseekCreate.mockResolvedValue({ choices: [{ message: { content: 'deepseek reply' } }] });
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'claude reply' }] });
    mocks.anthropicStream.mockReturnValue((async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'claude ' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'stream' } };
    })());
  });

  afterEach(() => {
    if (previousDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
  });

  it('caches clients by provider and model while keeping provider defaults', () => {
    expect(getAiClient('deepseek')).toBe(getAiClient('deepseek'));
    expect(getAiClient('claude')).toBe(getAiClient('claude'));
    expect(getAiClient('deepseek')).not.toBe(getAiClient('claude'));
    expect(getAiClient('deepseek').model).toBe('deepseek-chat');
    expect(getAiClient('claude').model).toBe('claude-opus-4-5');

    const flash = getAiClient('deepseek', 'deepseek-flash');
    const sonnet = getAiClient('claude', 'claude-sonnet-5-5');
    expect(flash).toBe(getAiClient('deepseek', 'deepseek-flash'));
    expect(flash).not.toBe(getAiClient('deepseek'));
    expect(flash.model).toBe('deepseek-flash');
    expect(sonnet.model).toBe('claude-sonnet-5-5');
  });

  it('rejects a model that is unknown or belongs to the other provider', () => {
    expect(() => getAiClient('deepseek', 'claude-opus-4-5')).toThrow(/claude-opus-4-5/);
    expect(() => getAiClient('claude', 'retired-model')).toThrow(/retired-model/);
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

  it('passes temperature only when a caller explicitly requests it', async () => {
    const deepseek = createDeepSeekClient();
    await deepseek.chat([{ role: 'user', content: 'No temperature option.' }]);
    expect(mocks.deepseekCreate).toHaveBeenLastCalledWith(expect.not.objectContaining({ temperature: expect.anything() }));
    await deepseek.chat([{ role: 'user', content: 'Deterministic JSON.' }], { json: true, temperature: 0 });
    expect(mocks.deepseekCreate).toHaveBeenLastCalledWith(expect.objectContaining({ temperature: 0 }));

    const claude = createClaudeClient();
    await claude.chat([{ role: 'user', content: 'No temperature option.' }]);
    expect(mocks.anthropicCreate).toHaveBeenLastCalledWith(expect.not.objectContaining({ temperature: expect.anything() }));
    await claude.chat([{ role: 'user', content: 'Deterministic JSON.' }], { json: true, temperature: 0 });
    expect(mocks.anthropicCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      temperature: 0,
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    }));
  });

  it('applies each selected model capabilities and output-token ceiling in the client layer', async () => {
    const flash = createDeepSeekClient('deepseek-flash');
    expect(flash.model).toBe('deepseek-flash');
    await flash.chat([{ role: 'user', content: 'Return JSON.' }], { json: true, maxTokens: 500_000, temperature: 0 });
    expect(mocks.deepseekCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      model: 'deepseek-flash', max_tokens: 384_000, response_format: { type: 'json_object' },
    }));
    expect(mocks.deepseekCreate).toHaveBeenLastCalledWith(expect.not.objectContaining({ temperature: expect.anything() }));

    const sonnet = createClaudeClient('claude-sonnet-5-5');
    expect(sonnet.model).toBe('claude-sonnet-5-5');
    await sonnet.chat([{ role: 'user', content: 'Return JSON.' }], { json: true, maxTokens: 200_000, temperature: 0 });
    expect(mocks.anthropicCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      model: 'claude-sonnet-5-5', max_tokens: 128_000,
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    }));
    expect(mocks.anthropicCreate).toHaveBeenLastCalledWith(expect.not.objectContaining({ temperature: expect.anything() }));
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

  it('fails fast for missing DeepSeek API keys in chat and stream', async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const client = createDeepSeekClient();
      const message = 'Chưa cấu hình DEEPSEEK_API_KEY trong .env. Hãy đổi sang nhà cung cấp khác hoặc dùng chế độ thủ công.';

      await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({
        status: 400,
        code: 'AI_KEY_MISSING',
        message,
      });
      await expect((async () => {
        for await (const value of client.stream([{ role: 'user', content: 'hello' }])) void value;
      })()).rejects.toMatchObject({ status: 400, code: 'AI_KEY_MISSING', message });
      expect(mocks.deepseekCreate).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
    }
  });

  it('fails fast for missing Anthropic API keys in chat and stream', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const client = createClaudeClient();
      const message = 'Chưa cấu hình ANTHROPIC_API_KEY trong .env. Hãy đổi sang nhà cung cấp khác hoặc dùng chế độ thủ công.';

      await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({
        status: 400,
        code: 'AI_KEY_MISSING',
        message,
      });
      await expect((async () => {
        for await (const value of client.stream([{ role: 'user', content: 'hello' }])) void value;
      })()).rejects.toMatchObject({ status: 400, code: 'AI_KEY_MISSING', message });
      expect(mocks.anthropicCreate).not.toHaveBeenCalled();
      expect(mocks.anthropicStream).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
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
    expect((error as Error).message).toContain('deepseek-chat');
    expect((error as Error).message).not.toContain('sk-test-must-not-leak');
  });

  it('gives an actionable Vietnamese error for a model that the provider no longer serves', async () => {
    const client = createDeepSeekClient('deepseek-v4-pro');
    mocks.deepseekCreate.mockRejectedValueOnce(Object.assign(new Error('model not found'), { status: 404 }));

    const error = await client.chat([{ role: 'user', content: 'hello' }]).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 404, code: 'AI_REQUEST_FAILED' });
    expect((error as Error).message).toContain('deepseek-v4-pro');
    expect((error as Error).message).toContain('hãy chọn model khác');
  });

  it('maps DeepSeek timeout and network errors without exposing the key', async () => {
    const client = createDeepSeekClient();
    mocks.deepseekCreate.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo ENOTFOUND api.deepseek.com sk-secret'), { code: 'ENOTFOUND' }));

    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({
      code: 'AI_REQUEST_FAILED',
      message: 'Cannot reach api.deepseek.com (timeout/network) for model deepseek-chat.',
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
        message: 'Cannot reach api.deepseek.com (timeout/network) for model deepseek-chat.',
      });
    } finally {
      if (previous === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
      else process.env.AI_REQUEST_TIMEOUT_MS = previous;
    }
  });
});
