import type { Collection } from 'mongodb';
import { getCollection } from '../../db/client';
import { ProjectDocSchema, type ProjectDoc } from './docs';
import { escapeRegex } from './title-search';

function collection(): Collection<ProjectDoc> {
  return getCollection<ProjectDoc>('projects');
}

export async function insertProject(doc: ProjectDoc): Promise<void> {
  await collection().insertOne(doc);
}

export async function findProjectById(id: string): Promise<ProjectDoc | null> {
  const doc = await collection().findOne({ _id: id });
  return doc ? ProjectDocSchema.parse(doc) : null;
}

export async function deleteProjectById(id: string): Promise<number> {
  const result = await collection().deleteOne({ _id: id });
  return result.deletedCount;
}


/** One row of the project list, with scenesCount/durationSec computed in the query itself. */
export type ProjectSummaryRow = {
  _id: string;
  title: string;
  status: ProjectDoc['status'];
  updatedAt: Date;
  scenesCount: number | null;
  durationSec: number | null;
};

export type ListProjectsFilter = { q?: string; status?: ProjectDoc['status'] };

/** Search runs on titleSearch (accent-insensitive), sorted by updatedAt desc, capped at 200. */
export async function listProjectSummaries(filter: ListProjectsFilter): Promise<ProjectSummaryRow[]> {
  const match: Record<string, unknown> = {};
  if (filter.status) match.status = filter.status;
  if (filter.q) match.titleSearch = { $regex: escapeRegex(filter.q), $options: 'i' };

  return collection()
    .aggregate<ProjectSummaryRow>([
      { $match: match },
      { $sort: { updatedAt: -1 } },
      { $limit: 200 },
      {
        $project: {
          _id: 1,
          title: 1,
          status: 1,
          updatedAt: 1,
          scenesCount: { $cond: [{ $gt: [{ $size: '$scenes' }, 0] }, { $size: '$scenes' }, null] },
          durationSec: { $cond: [{ $gt: [{ $size: '$scenes' }, 0] }, { $round: [{ $sum: '$scenes.durationSec' }, 2] }, null] },
        },
      },
    ])
    .toArray();
}
