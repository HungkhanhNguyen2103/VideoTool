import type { ChapterSnapshot } from '../../../contracts/script';
import { getProjectHistory } from '../project';

export async function findProjectChapterHistory(projectId: string): Promise<ChapterSnapshot[]> {
  return getProjectHistory(projectId);
}
