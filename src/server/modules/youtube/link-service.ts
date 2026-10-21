import { normalizeSeoTitleForComparison } from '../seo';
import { getProject, listProjects } from '../project';
import { listVideoDocs } from './repo';

export type YoutubeTitleMatch = 'exact' | 'containment' | 'none';

export function compareYoutubeTitleLink(chosenTitle: string, videoTitle: string, publishDateDays: number): { titleMatch: YoutubeTitleMatch; dateWithinThirtyDays: boolean; score: number } {
  const chosen = normalizeSeoTitleForComparison(chosenTitle);
  const video = normalizeSeoTitleForComparison(videoTitle);
  let titleMatch: YoutubeTitleMatch = 'none';
  if (chosen && video && chosen === video) titleMatch = 'exact';
  else if (Math.min([...chosen].length, [...video].length) >= 12 && chosen && video && (chosen.includes(video) || video.includes(chosen))) titleMatch = 'containment';
  const dateWithinThirtyDays = Number.isFinite(publishDateDays) && Math.abs(publishDateDays) <= 30;
  const titleScore = titleMatch === 'exact' ? 1.5 : titleMatch === 'containment' ? 1 : 0;
  const dateScore = dateWithinThirtyDays ? (30 - Math.abs(publishDateDays)) / 60 : 0;
  return { titleMatch, dateWithinThirtyDays, score: titleScore + dateScore };
}

export async function getSuggestedYoutubeLinks(profileId: string): Promise<Array<{
  projectId: string;
  projectTitle: string;
  chosenSeoTitle: string;
  videoId: string;
  videoTitle: string;
  titleMatch: YoutubeTitleMatch;
  publishDateDays: number;
  score: number;
  reasons: string[];
}>> {
  const [videos, summaries] = await Promise.all([
    listVideoDocs(profileId, { removed: { $ne: true } }),
    listProjects({}),
  ]);
  const linkedIds = new Set(summaries.flatMap((summary) => summary.youtubeVideoId ? [summary.youtubeVideoId] : []));
  const projects = await Promise.all(summaries.filter((summary) => summary.channelId === profileId && !summary.youtubeVideoId).map((summary) => getProject(summary.id)));
  const suggestions: Awaited<ReturnType<typeof getSuggestedYoutubeLinks>> = [];
  for (const project of projects) {
    const chosenTitle = project.seo.titles.find((title) => title.id === project.seo.chosenTitleId)?.text;
    if (!chosenTitle) continue;
    for (const video of videos) {
      if (linkedIds.has(video.videoId) || !video.publishedAt) continue;
      const publishDateDays = (new Date(video.publishedAt).getTime() - new Date(project.createdAt).getTime()) / 86_400_000;
      const match = compareYoutubeTitleLink(chosenTitle, video.title, publishDateDays);
      if (match.titleMatch === 'none' && Math.abs(publishDateDays) > 7) continue;
      suggestions.push({
        projectId: project.id,
        projectTitle: project.title,
        chosenSeoTitle: chosenTitle,
        videoId: video.videoId,
        videoTitle: video.title,
        titleMatch: match.titleMatch,
        publishDateDays,
        score: match.score,
        reasons: [
          ...(match.titleMatch === 'exact' ? ['Tiêu đề SEO khớp sau chuẩn hóa dấu và dấu câu.'] : match.titleMatch === 'containment' ? ['Tiêu đề SEO có phần trùng đáng kể.'] : []),
          ...(Math.abs(publishDateDays) <= 30 ? [`Ngày đăng cách ngày tạo dự án ${Math.round(Math.abs(publishDateDays))} ngày.`] : []),
        ],
      });
    }
  }
  return suggestions.sort((a, b) => b.score - a.score || a.projectTitle.localeCompare(b.projectTitle) || a.videoTitle.localeCompare(b.videoTitle)).slice(0, 100);
}
