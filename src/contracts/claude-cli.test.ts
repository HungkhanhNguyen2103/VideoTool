import { describe, expect, it } from 'vitest';
import { CLAUDE_CLI_DEFAULT_EFFORT, CLAUDE_CLI_DEFAULT_MODEL, CLAUDE_CLI_EFFORT_LEVELS } from './claude-cli';
import { getDefaultAiModelId } from './ai-models';

describe('Claude CLI product defaults', () => {
  it('keeps the CLI default separate from the Claude API default', () => {
    expect(CLAUDE_CLI_DEFAULT_MODEL).toBe('claude-sonnet-5-5');
    expect(CLAUDE_CLI_DEFAULT_EFFORT).toBe('medium');
    expect(getDefaultAiModelId('claude')).not.toBe(CLAUDE_CLI_DEFAULT_MODEL);
  });

  it('matches the effort levels accepted by the installed CLI help', () => {
    expect(CLAUDE_CLI_EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});
