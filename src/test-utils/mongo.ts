import { MongoMemoryServer } from 'mongodb-memory-server';
import { closeDb, connectDb, getCollection } from '../server/db/client';
import type { JobDoc } from '../server/modules/job/docs';

let memoryServer: MongoMemoryServer | null = null;

export async function startTestMongo(): Promise<void> {
  try {
    memoryServer = await MongoMemoryServer.create();
    await connectDb(memoryServer.getUri(), 'video_tool_test');
  } catch (error) {
    memoryServer = null;
    const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017';
    await connectDb(uri, process.env.MONGODB_TEST_DB ?? 'video_tool_test');
    console.warn(`mongodb-memory-server unavailable; using local MongoDB fallback: ${String(error)}`);
  }
}

export async function resetTestMongo(): Promise<void> {
  await getCollection<JobDoc>('jobs').deleteMany({});
}

export async function closeTestMongo(): Promise<void> {
  await closeDb();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
