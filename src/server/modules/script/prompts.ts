import type { ProjectDetail } from '../../../contracts/project';
import type { ChapterDoc } from '../../../contracts/script';

export function buildScriptPrompt(project: ProjectDetail): { system: string; user: string } {
  return {
    system: [
      'You are a professional video script writer.',
      `Write the script content in ${project.language === 'vi' ? 'Vietnamese' : 'English'}.`,
      'Return only a valid JSON array. Do not use markdown fences, headings, or prose outside the JSON.',
      'Each item must have no, title, paragraphs (string array), scenesCount (null), and durationSec (null).',
    ].join(' '),
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Script preset: ${project.scriptPresetId}`,
      `Target duration seconds: ${project.targetDurationSec}`,
      `Chapter count: ${project.chapterCount ?? 'choose a suitable count'}`,
    ].join('\n'),
  };
}

export function buildRegenerationPrompt(
  project: ProjectDetail,
  chapter: ChapterDoc,
  instruction: string,
  level: 'light' | 'medium' | 'rewrite',
): { system: string; user: string } {
  return {
    system: `Rewrite one chapter in ${project.language === 'vi' ? 'Vietnamese' : 'English'} and return only JSON in the form {"paragraphs":["..."]}. Do not use markdown fences. Regeneration level: ${level}.`,
    user: [
      `Chapter ${chapter.no}: ${chapter.title}`,
      `Current paragraphs:\n${chapter.paragraphs.join('\n\n')}`,
      `Instruction: ${instruction || '(none)'}`,
    ].join('\n\n'),
  };
}
