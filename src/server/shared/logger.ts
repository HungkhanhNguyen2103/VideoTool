type Level = 'debug' | 'info' | 'warn' | 'error';

const QUIET_IN_TEST: Level[] = ['debug', 'info', 'warn'];

function write(level: Level, message: string, meta?: unknown): void {
  if (process.env.NODE_ENV === 'test' && QUIET_IN_TEST.includes(level)) return;
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta === undefined) sink(line);
  else sink(line, meta);
}

/** Tiny console wrapper. Swap the internals here if a real logger is ever needed. */
export const logger = {
  debug: (message: string, meta?: unknown) => write('debug', message, meta),
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta),
};
