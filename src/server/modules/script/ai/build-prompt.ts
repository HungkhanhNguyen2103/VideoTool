import type { ProjectDetail } from '../../../../contracts/project';
import type { ChapterDoc, OpenLoop } from '../../../../contracts/script';
import { NARRATION_WORDS_PER_MINUTE } from '../../../../contracts/script';
import { loadScriptPreset, type ScriptPreset } from './presets/loader';
import { SCRIPT_PRESET_CONFIG } from './presets/config';

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
export type ChapterExpansionPromptInput = {
  project: ProjectDetail;
  chapter: Pick<ChapterDoc, 'no' | 'title' | 'role' | 'beat' | 'targetWords' | 'endsOnTension'>;
  openLoops: readonly (OpenLoop | string)[];
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

export function buildOutlinePrompt(project: ProjectDetail): BuiltPrompt {
  const preset = loadScriptPreset(project.scriptPresetId);
  const count = project.chapterCount ? `exactly ${project.chapterCount} chapters` : 'choose between 1 and 20 chapters';
  const shape = project.scriptPresetId === 'hubris-trap'
    ? 'Include motif with hunter, perfectPlan, blindSpot, and selfDestruction.'
    : 'Do not include motif.';
  const weightingConfig = SCRIPT_PRESET_CONFIG[project.scriptPresetId];
  const weighting = weightingConfig.weightingStrictness === 'none'
    ? 'Use a flatter explanatory progression rather than a dramatic five-act weighting.'
    : weightingConfig.weightingStrictness === 'soft'
      ? `Use five-act weighting as a guideline: ${weightingConfig.actWeighting!.join('% / ')}%; deviate if pacing calls for it.`
      : `Follow five-act weighting closely as a requirement: ${weightingConfig.actWeighting!.join('% / ')}%.`;
  return {
    system: systemMessage(preset, `Return one JSON outline object with non-empty coreQuestion, openingHook, chapters, openLoops, and the preset-specific motif rule. coreQuestion must name the central question or problem the whole video answers. openingHook must be the actual candidate opening line or idea for the video, not a description of one. Each chapter must have no, title, role, beat, positive targetWords, and endsOnTension. ${shape} ${weighting}`),
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Language: ${language(project)}`,
      `Total narration word budget: ${Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE)} words`,
      `Create ${count}.`,
    ].join('\n'),
    promptVersion: version(preset),
  };
}

export function buildChapterExpansionPrompt(input: ChapterExpansionPromptInput): BuiltPrompt {
  const { project, chapter, openLoops, styleNote } = input;
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, 'Return one JSON object with paragraphs (string array) and styleNote (string, at most 500 characters).'),
    user: [
      `Language: ${language(project)}`,
      `Chapter ${chapter.no}: ${chapter.title}`,
      `Role: ${chapter.role || '(unspecified)'}`,
      `Beat: ${chapter.beat || '(unspecified)'}`,
      `Target words: ${chapter.targetWords ?? '(unspecified)'}`,
      `Ends on tension: ${chapter.endsOnTension ? 'yes' : 'no'}`,
      `Open loops: ${openLoops.map((loop) => typeof loop === 'string' ? loop : loop.question).join(' | ') || '(none)'}`,
      `Existing style note: ${styleNote.slice(0, 500) || '(none)'}`,
    ].join('\n\n'),
    promptVersion: version(preset),
  };
}

export function buildManualScriptPrompt(project: ProjectDetail): BuiltPrompt {
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, 'Return one complete script document with non-empty coreQuestion and openingHook at the document root, plus chapters containing no, title, role, beat, positive targetWords, endsOnTension, and paragraphs; also include openLoops and the preset-specific motif rule. coreQuestion must name the central question or problem the whole video answers. openingHook must be the actual candidate opening line or idea for the video, not a description of one.'),
    user: [
      `Write the complete script document for project: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Language: ${language(project)}`,
      `Total narration word budget: ${Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE)} words`,
      project.chapterCount ? `Use exactly ${project.chapterCount} chapters.` : 'Choose between 1 and 20 chapters.',
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
