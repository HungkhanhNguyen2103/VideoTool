// Product defaults requested by Hung; they are not Anthropic recommendations.
export const CLAUDE_CLI_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_CLI_DEFAULT_EFFORT = 'medium';

export const CLAUDE_CLI_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ClaudeCliEffort = (typeof CLAUDE_CLI_EFFORT_LEVELS)[number];
