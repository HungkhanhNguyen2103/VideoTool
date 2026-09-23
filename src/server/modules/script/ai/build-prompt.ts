import type { ProjectDetail } from '../../../../contracts/project';
import type { ChapterDoc } from '../../../../contracts/script';
import { loadScriptPreset, type ScriptPreset } from './presets/loader';

export type BuiltPrompt = { system: string; user: string; promptVersion: string };
export type VisualPromptSceneInput = {
  sceneId: string;
  sceneIndex: number;
  narration: string;
  visualPrompt: string;
};
export type VisualPromptPromptInput = {
  project: ProjectDetail;
  chapter: ChapterDoc;
  scenes: readonly VisualPromptSceneInput[];
  styleNote: string;
};

function version(preset: ScriptPreset): string {
  return `script-prompt-v1/${preset.id}@${preset.version}`;
}

function language(project: ProjectDetail): string {
  return project.language === 'vi' ? 'Vietnamese' : 'English';
}

function systemMessage(preset: ScriptPreset, contract: string): string {
  return [
    'You are a professional video script writer. Return only valid JSON. Do not use markdown fences, headings, or prose outside the JSON.',
    contract,
    preset.system,
    preset.instructions,
  ].join('\n\n');
}

export function buildScriptPrompt(project: ProjectDetail): BuiltPrompt {
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, 'Return a JSON array. Each item must have no, title, paragraphs (string array), scenesCount (null), and durationSec (null).'),
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Script preset: ${project.scriptPresetId}`,
      `Language: ${language(project)}`,
      `Chapter count: ${project.chapterCount ?? 'choose a suitable count'}`,
      `Target duration seconds: ${project.targetDurationSec}`,
    ].join('\n'),
    promptVersion: version(preset),
  };
}

export function buildRegenerationPrompt(
  project: ProjectDetail,
  chapter: ChapterDoc,
  instruction: string,
  level: 'light' | 'medium' | 'rewrite',
): BuiltPrompt {
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, 'Rewrite one chapter and return JSON in the form {"paragraphs":["..."]}.'),
    user: [
      `Language: ${language(project)}`,
      `Chapter ${chapter.no}: ${chapter.title}`,
      `Current paragraphs:\n${chapter.paragraphs.join('\n\n')}`,
      `Instruction: ${instruction || '(none)'}`,
      `Regeneration level: ${level}`,
    ].join('\n\n'),
    promptVersion: version(preset),
  };
}

export function buildVisualPromptPrompt(input: VisualPromptPromptInput): BuiltPrompt {
  const { project, chapter, scenes, styleNote } = input;
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, 'Return one JSON object with styleNote (at most 500 characters) and prompts, an array with exactly one {sceneIndex, visualPrompt} object per input scene. Use positive one-based indexes and non-empty visual prompts. Existing visual prompts are references; preserve their intent.'),
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `Language: ${language(project)}`,
      `Chapter ${chapter.no}: ${chapter.title}`,
      `Previous style note: ${styleNote.slice(0, 500)}`,
      `This chapter contains exactly ${scenes.length} scenes. Return exactly ${scenes.length} prompt objects, one for every supplied sceneIndex. Echo each supplied sceneIndex exactly; do not invent, omit, duplicate, or renumber indexes.`,
      'Scenes:',
      ...scenes.map((scene) => `Scene ${scene.sceneIndex}\nNarration: ${scene.narration}\nExisting visual prompt: ${scene.visualPrompt || '(none)'}`),
    ].join('\n\n'),
    promptVersion: version(preset),
  };
}
