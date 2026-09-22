import { ensureProjectIndexes } from '../modules/project';

/**
 * Explicit registry of index creators. Each module exports its own `ensure<Name>Indexes`
 * from its index.ts; add the call here when a module owns a collection with indexes.
 * Safe to run on every startup (createIndex is idempotent).
 */
export async function ensureIndexes(): Promise<void> {
  await ensureProjectIndexes();
}
