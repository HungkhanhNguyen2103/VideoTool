import type { AssetType } from '../../../../contracts/asset';
import type { ProjectDetail, VisualStyleId } from '../../../../contracts/project';
import type { ChapterDoc, OpenLoop } from '../../../../contracts/script';
import { NARRATIVE_ROLES, NARRATION_WORDS_PER_MINUTE } from '../../../../contracts/script';
import { loadScriptPreset, type ScriptPreset } from './presets/loader';
import { loadVisualStylePreset } from './presets/visual-style-loader';
import { SCRIPT_PRESET_CONFIG } from './presets/config';
import { QA_ISSUE_TYPES, QA_SUGGESTED_ACTIONS } from './qa-schema';

export type BuiltPrompt = { system: string; user: string; promptVersion: string };
export type VisualPromptSceneInput = {
  sceneId: string;
  sceneIndex: number;
  narration: string;
  assetType: AssetType;
  visualPrompt: string;
  sfxPrompt?: string;
  motionPrompt?: string;
};
export type VisualPromptPromptInput = {
  project: ProjectDetail;
  chapter: ChapterDoc;
  scenes: readonly VisualPromptSceneInput[];
  styleNote: string;
  visualStylePresetId: VisualStyleId;
  coreQuestion: string;
  openingHook: string | null;
  previousChapterSummary: string | null;
  previousAvoidRepeating: string[];
  previousPersistentFacts: string[];
};
export type SceneSplitSceneInput = {
  sceneId: string;
  sceneIndex: number;
  narration: string;
};
export type SceneSplitPromptInput = {
  project: ProjectDetail;
  chapter: Pick<ChapterDoc, 'no' | 'title'>;
  scenes: readonly SceneSplitSceneInput[];
};
export type ChapterExpansionPromptInput = {
  project: ProjectDetail;
  chapter: Pick<ChapterDoc, 'no' | 'title' | 'role' | 'beat' | 'targetWords' | 'endsOnTension'>;
  coreQuestion: string;
  openingHook: string | null;
  previousChapterSummary: string | null;
  previousAvoidRepeating: string[];
  previousPersistentFacts: string[];
  openLoops: readonly (OpenLoop | string)[];
  styleNote: string;
};

const PERSISTENT_FACTS_INSTRUCTION = 'persistentFacts is NOT a chapter summary. Keep only facts or narrative state that a later chapter could accidentally contradict, reintroduce as new, or forget while it remains relevant. Drop facts that are no longer useful. Return the COMPLETE next persistentFacts state, not a delta. Maximum 5 items.';
const SCRIPT_STRUCTURE_CONTRACT = [
  `Allowed role values are exactly: ${NARRATIVE_ROLES.join(', ')}.`,
  'Each chapter object must contain exactly no, title, role, beat, targetWords, and endsOnTension; no extra keys. targetWords must be an integer and positive, not a string.',
  'Example chapter: {"no":1,"title":"The opening","role":"hook","beat":"Raise the central question","targetWords":300,"endsOnTension":true}.',
  'Each openLoop object must contain exactly question, plantedInChapter, and resolvedInChapter; no extra keys. plantedInChapter and resolvedInChapter are positive integers, not strings.',
  'Example openLoop: {"question":"What caused the disaster?","plantedInChapter":1,"resolvedInChapter":3}.',
].join(' ');
const EXPANSION_LENGTH_CONTRACT = 'styleNote max 500 chars, chapterSummary max 250 chars, avoidRepeating max 5 items each max 80 chars, persistentFactsNext max 5 items each max 120 chars.';

type RegenerationPromptContext = {
  coreQuestion: string;
  openingHook: string | null;
  openLoops: readonly (OpenLoop | string)[];
  previousChapterSummary: string | null;
  previousAvoidRepeating: string[];
  previousPersistentFacts: string[];
};

function version(preset: ScriptPreset): string {
  return `script-prompt-v2/${preset.id}@${preset.version}`;
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
    system: systemMessage(preset, `Return one JSON outline object with non-empty coreQuestion, openingHook, chapters, openLoops, and the preset-specific motif rule. ${SCRIPT_STRUCTURE_CONTRACT} coreQuestion must name the central question or problem the whole video answers. openingHook must be the actual candidate opening line or idea for the video, not a description of one. ${shape} ${weighting}`),
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Language: ${language(project)}`,
      `Total narration word budget: ${Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE)} words; the sum of all targetWords must equal this budget.`,
      `Create ${count}; chapter count must be exact.`,
    ].join('\n'),
    promptVersion: version(preset),
  };
}

export function buildChapterExpansionPrompt(input: ChapterExpansionPromptInput): BuiltPrompt {
  const { project, chapter, coreQuestion, openingHook, previousChapterSummary, previousAvoidRepeating, previousPersistentFacts, openLoops, styleNote } = input;
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, `Return one JSON object with paragraphs (string array), styleNote (string), chapterSummary (string), avoidRepeating (array), and persistentFactsNext (array). ${EXPANSION_LENGTH_CONTRACT} ${PERSISTENT_FACTS_INSTRUCTION}`),
    user: [
      `Language: ${language(project)}`,
      `Core question: ${coreQuestion}`,
      ...(openingHook !== null ? [`Opening hook: ${openingHook}`] : []),
      `Chapter ${chapter.no}: ${chapter.title}`,
      `Role: ${chapter.role || '(unspecified)'}`,
      `Beat: ${chapter.beat || '(unspecified)'}`,
      `Target words: ${chapter.targetWords ?? '(unspecified)'}`,
      `Ends on tension: ${chapter.endsOnTension ? 'yes' : 'no'}`,
      `Previous chapter summary: ${previousChapterSummary ?? '(none)'}`,
      `Avoid repeating: ${previousAvoidRepeating.join(' | ') || '(none)'}`,
      `Persistent facts: ${previousPersistentFacts.join(' | ') || '(none)'}`,
      `Open loops: ${openLoops.map((loop) => typeof loop === 'string' ? loop : loop.question).join(' | ') || '(none)'}`,
      `Existing style note: ${styleNote.slice(0, 500) || '(none)'}`,
    ].join('\n\n'),
    promptVersion: version(preset),
  };
}

export function buildManualScriptPrompt(project: ProjectDetail): BuiltPrompt {
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, `Return one complete script document with non-empty coreQuestion and openingHook at the document root, plus chapters containing no, title, role, beat, positive targetWords, endsOnTension, and paragraphs; also include openLoops and the preset-specific motif rule. ${SCRIPT_STRUCTURE_CONTRACT} coreQuestion must name the central question or problem the whole video answers. openingHook must be the actual candidate opening line or idea for the video, not a description of one.`),
    user: [
      `Write the complete script document for project: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Language: ${language(project)}`,
      `Total narration word budget: ${Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE)} words; the sum of all targetWords must equal this budget.`,
      project.chapterCount ? `Use exactly ${project.chapterCount} chapters; chapter count must be exact.` : 'Choose between 1 and 20 chapters.',
    ].join('\n'),
    promptVersion: version(preset),
  };
}

export function buildRegenerationPrompt(
  project: ProjectDetail,
  chapter: ChapterDoc,
  instruction: string,
  level: 'light' | 'medium' | 'rewrite',
  context: RegenerationPromptContext,
): BuiltPrompt {
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, `Rewrite one chapter and return one JSON object with paragraphs (string array), chapterSummary (string, at most 250 characters), avoidRepeating (array, at most 5 items of at most 80 characters each), and persistentFactsNext (array, at most 5 items of at most 120 characters each). ${PERSISTENT_FACTS_INSTRUCTION}`),
    user: [
      `Language: ${language(project)}`,
      `Core question: ${context.coreQuestion}`,
      ...(context.openingHook !== null ? [`Opening hook: ${context.openingHook}`] : []),
      `Chapter ${chapter.no}: ${chapter.title}`,
      `Role: ${chapter.role || '(unspecified)'}`,
      `Beat: ${chapter.beat || '(unspecified)'}`,
      `Target words: ${chapter.targetWords ?? '(unspecified)'}`,
      `Ends on tension: ${chapter.endsOnTension ? 'yes' : 'no'}`,
      `Current paragraphs:\n${chapter.paragraphs.join('\n\n')}`,
      `Previous chapter summary: ${context.previousChapterSummary ?? '(none)'}`,
      `Avoid repeating: ${context.previousAvoidRepeating.join(' | ') || '(none)'}`,
      `Persistent facts: ${context.previousPersistentFacts.join(' | ') || '(none)'}`,
      `Open loops: ${context.openLoops.map((loop) => typeof loop === 'string' ? loop : loop.question).join(' | ') || '(none)'}`,
      `Instruction: ${instruction || '(none)'}`,
      `Regeneration level: ${level}`,
    ].join('\n\n'),
    promptVersion: version(preset),
  };
}

export function buildVisualPromptPrompt(input: VisualPromptPromptInput): BuiltPrompt {
  const { project, chapter, scenes, styleNote, visualStylePresetId, coreQuestion, openingHook, previousChapterSummary, previousAvoidRepeating, previousPersistentFacts } = input;
  const scriptPreset = loadScriptPreset(project.scriptPresetId);
  const visualPreset = loadVisualStylePreset(visualStylePresetId);
  return {
    system: systemMessage(scriptPreset, "Return one JSON object with styleNote (at most 500 characters) and prompts, an array with exactly one {sceneIndex, visualPrompt, sfxPrompt, motionPrompt} object per input scene. Use positive one-based indexes and non-empty visual prompts. sfxPrompt should be a short ambient or foley sound-search phrase in English (2-6 words, like a Freesound search query — e.g. 'pen writing on paper', 'quiet sigh', 'coffee dripping'), regardless of the narration language, or an empty string when no sound is appropriate. motionPrompt should be a short English animation instruction of roughly one or two sentences describing a camera move and what the subject does, intended for image-to-video generation. Only write a non-empty motionPrompt when that scene's asset type is video; return an empty string for image scenes. Existing visual prompts, SFX prompts, and motion prompts are references; preserve their intent."),
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `Language: ${language(project)}`,
      `Required visual style (must follow for every scene): ${visualPreset.style}`,
      `Core question: ${coreQuestion}`,
      `Chapter ${chapter.no}: ${chapter.title}`,
      `Opening hook: ${openingHook || '(none)'}`,
      `Previous chapter summary: ${previousChapterSummary ?? '(none)'}`,
      `Avoid repeating: ${previousAvoidRepeating.join(' | ') || '(none)'}`,
      `Persistent facts: ${previousPersistentFacts.join(' | ') || '(none)'}`,
      `Previous style note: ${styleNote.slice(0, 500)}`,
      `This chapter contains exactly ${scenes.length} scenes. Return exactly ${scenes.length} prompt objects, one for every supplied sceneIndex. Echo each supplied sceneIndex exactly; do not invent, omit, duplicate, or renumber indexes.`,
      'Scenes:',
      ...scenes.map((scene) => `Scene ${scene.sceneIndex}\nNarration: ${scene.narration}\nAsset type: ${scene.assetType}\nExisting visual prompt: ${scene.visualPrompt || '(none)'}\nExisting SFX prompt: ${scene.sfxPrompt || '(none)'}\nExisting motion prompt: ${scene.motionPrompt || '(none)'}`),
    ].join('\n\n'),
    promptVersion: `visual-prompt-v1/${visualPreset.id}@${visualPreset.version}`,
  };
}

export function buildSceneSplitPrompt(input: SceneSplitPromptInput): BuiltPrompt {
  const { project, chapter, scenes } = input;
  return {
    system: 'You select visual cut points in existing narration. Return only valid JSON with a scenes array. For every supplied sceneIndex, return one object containing that exact sceneIndex and chunks, an array of non-empty strings. Each chunk must be an exact contiguous substring of its source narration. Do not reword, add, remove, or otherwise modify any narration text. Preserve the source text in order. Echo each supplied sceneIndex exactly once; do not invent, omit, duplicate, or renumber indexes.',
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Language: ${language(project)}`,
      `Chapter ${chapter.no}: ${chapter.title}`,
      `Split each narration into visual beats only where a meaningful visual change occurs. Return one item for every supplied sceneIndex.`,
      'Scenes:',
      ...scenes.map((scene) => `Scene ${scene.sceneIndex}\nNarration: ${scene.narration}`),
    ].join('\n\n'),
    promptVersion: 'scene-split-v1',
  };
}

export function buildQaPrompt(project: ProjectDetail): BuiltPrompt {
  const preset = loadScriptPreset(project.scriptPresetId);
  const issueTypes = QA_ISSUE_TYPES.join(', ');
  const actions = QA_SUGGESTED_ACTIONS.join(', ');
  return {
    system: systemMessage(preset, `Return one strict JSON object: {"issues":[...]}. Each issue must contain only chapter (positive integer), type (${issueTypes}), severity (low, medium, or high), reason, and suggestedAction (${actions}). Do not return a score, suggestedFix, or any other field. Detect and flag issues only; do not rewrite any text.`),
    user: [
      `Project title: ${project.title}`,
      `Language: ${language(project)}`,
      `Write each issue reason in ${language(project)}.`,
      `Core question: ${project.coreQuestion || '(none)'}`,
      `Opening hook: ${project.openingHook || '(none)'}`,
      `Open loops: ${project.openLoops.map((loop) => `chapter ${loop.plantedInChapter}->${loop.resolvedInChapter}: ${loop.question}`).join(' | ') || '(none)'}`,
      'Evaluate every chapter and the transitions between them for repetition, contradiction, dead chapters, and possible filler. For POSSIBLE_FILLER, apply the Chapter Deletion Test: judge the chapter\'s narrative function, information value, pacing/breathing-room role, and setup/payoff contribution; flag it if removing it would not measurably hurt the video.',
      'Also evaluate whether the hook is weak or missing relative to openingHook, pacing is flat, reveals arrive prematurely, open loops remain unresolved, payoffs are weak, transitions are awkward, tone drifts, or claims create credibility risk. Cross-reference each open loop\'s planted and resolved chapter against the actual content.',
      'Chapters:',
      ...project.chapters.map((chapter) => `Chapter ${chapter.no}: ${chapter.title}\nRole: ${chapter.role || '(none)'}\nBeat: ${chapter.beat || '(none)'}\nParagraphs:\n${chapter.paragraphs.join('\n\n')}`),
    ].join('\n\n'),
    promptVersion: version(preset),
  };
}
