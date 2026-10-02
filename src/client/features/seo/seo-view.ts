import type { ProjectDetail } from '../../../contracts/project';
import { assembleDescription, findUnsupportedFacts, hashtagStatus, tagBudget, thumbnailTextStatus, titleStatus } from '../../../contracts/seo-format';
import type { SeoTitleAngle, TitleOption } from '../../../contracts/seo';

export const TITLE_ANGLE_LABELS: Record<SeoTitleAngle, string> = {
  number: 'Con số',
  curiosity: 'Tò mò',
  stakes: 'Được–mất',
  question: 'Câu hỏi',
  contrarian: 'Phản biện',
};

export const AI_PROVIDER_LABELS = { deepseek: 'DeepSeek', claude: 'Claude', manual: 'Thủ công' } as const;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function saveStateLabel(state: SaveState): string {
  if (state === 'saving') return 'Đang lưu…';
  if (state === 'saved') return 'Đã lưu';
  if (state === 'error') return 'Lỗi lưu (thử lại)';
  return '';
}

function sourceText(project: ProjectDetail): string {
  return [
    project.title,
    project.brief,
    project.referencesText,
    project.coreQuestion,
    project.openingHook,
    ...project.chapters.flatMap((chapter) => [chapter.title, ...chapter.paragraphs]),
  ].join('\n');
}

export function selectedTitle(seo: ProjectDetail['seo']): TitleOption | null {
  return seo.titles.find((title) => title.id === seo.chosenTitleId) ?? seo.titles[0] ?? null;
}

export function buildSeoDisplay(project: ProjectDetail) {
  const seo = project.seo;
  const title = selectedTitle(seo);
  const factTexts = [
    title?.text ?? '',
    seo.descriptionIntro,
    ...seo.thumbnail.ideas.filter((idea) => idea.id === seo.thumbnail.chosenIdeaId).map((idea) => idea.overlayText),
  ];
  return {
    selectedTitle: title,
    description: assembleDescription(seo, project),
    titleStatuses: seo.titles.map((option) => ({ option, status: titleStatus(option.text) })),
    tagBudget: tagBudget(seo.tags),
    hashtagStatus: hashtagStatus(seo.hashtags),
    thumbnailTextStatus: thumbnailTextStatus(seo.thumbnail.ideas.find((idea) => idea.id === seo.thumbnail.chosenIdeaId)?.overlayText ?? ''),
    unsupportedFacts: findUnsupportedFacts(factTexts, sourceText(project)),
  };
}
