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
  channelId: string | null;
  youtubeVideoId: string | null;
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
        $addFields: {
          activeScenes: {
            $filter: {
              input: { $ifNull: ['$scenes', []] },
              as: 'scene',
              cond: { $ne: [{ $ifNull: ['$$scene.active', true] }, false] },
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          status: 1,
          channelId: { $ifNull: ['$channelId', null] },
          youtubeVideoId: { $ifNull: ['$youtubeVideoId', null] },
          updatedAt: 1,
          scenesCount: { $cond: [{ $gt: [{ $size: { $ifNull: ['$scenes', []] } }, 0] }, { $size: '$activeScenes' }, null] },
          durationSec: { $cond: [{ $gt: [{ $size: { $ifNull: ['$scenes', []] } }, 0] }, { $round: [{ $sum: '$activeScenes.durationSec' }, 2] }, null] },
        },
      },
    ])
    .toArray();
}

export async function listChosenSeoTitleTexts(channelId: string, excludeProjectId: string): Promise<string[]> {
  const rows = await collection()
    .aggregate<{ title: string }>([
      { $match: { channelId, _id: { $ne: excludeProjectId }, 'seo.chosenTitleId': { $type: 'string' } } },
      {
        $project: {
          _id: 0,
          title: {
            $let: {
              vars: {
                chosen: {
                  $first: {
                    $filter: {
                      input: { $ifNull: ['$seo.titles', []] },
                      as: 'title',
                      cond: { $eq: ['$$title.id', '$seo.chosenTitleId'] },
                    },
                  },
                },
              },
              in: '$$chosen.text',
            },
          },
        },
      },
      { $match: { title: { $type: 'string', $ne: '' } } },
      { $sort: { title: 1 } },
    ])
    .toArray();
  return rows.map((row) => row.title);
}
