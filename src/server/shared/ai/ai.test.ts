import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deepseekCreate: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicStream: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: mocks.deepseekCreate } };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = { create: mocks.anthropicCreate, stream: mocks.anthropicStream };
  },
}));

import { getAiClient } from './index';

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
});
