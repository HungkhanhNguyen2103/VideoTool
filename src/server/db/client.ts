import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

/** Connect once per process. Calling it again returns the existing connection. */
export async function connectDb(uri: string, dbName: string): Promise<Db> {
  if (db) return db;
  const next = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await next.connect();
  } catch (err) {
    await next.close().catch(() => undefined);
    throw err;
  }
  client = next;
  db = next.db(dbName);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database is not connected. Call connectDb() first.');
  return db;
}

export function getCollection<T extends Document>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

export async function closeDb(): Promise<void> {
  const current = client;
  client = null;
  db = null;
  if (current) await current.close();
}
