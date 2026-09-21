import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017'),
  MONGODB_DB: z.string().min(1).default('video_tool'),
  FILES_DIR: z.string().min(1).default('./data/files'),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(2000),
});

export type Config = z.infer<typeof EnvSchema>;

/** Thrown for invalid environment. main.ts prints only the message (no stack). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Parse and validate env once at startup; fail fast with a readable list of problems. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
  throw new ConfigError(`Invalid environment configuration:\n${lines.join('\n')}\nCheck your .env file (see .env.example).`);
}
