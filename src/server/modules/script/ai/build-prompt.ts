import type { AssetType } from '../../../../contracts/asset';
import type { ProjectDetail, VisualStyleId } from '../../../../contracts/project';
import type { ChapterDoc, OpenLoop } from '../../../../contracts/script';
import { NARRATIVE_ROLES, NARRATION_WORDS_PER_MINUTE } from '../../../../contracts/script';
import { loadScriptPreset, type ScriptPreset } from './presets/loader';
import { loadVisualStylePreset } from './presets/visual-style-loader';
import { SCRIPT_PRESET_CONFIG } from './presets/config';
import { recommendScriptChapterCount } from './outline-validation';
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
const SOURCE_FACT_CONTRACT = 'sourceFacts is optional but, when provided, contains at most 10 concise facts (max 300 characters each) copied or tightly condensed from the references and assigned to the chapter where each fact does the most work. Reuse a fact later only as a callback. If references use numbered source tags such as [1], each sourceFact must end with its exact source tag; do not invent tags. holdBack is optional and contains at most 4 items (max 200 characters each) naming reveals owned by later chapters. Never invent numbers, dates, names, or quotations. Give the decisive moment the richest evidence; when a source area is thin, assign fewer facts and a smaller targetWords budget instead of padding.';
const SCRIPT_STRUCTURE_CONTRACT = [
  `Allowed role values are exactly: ${NARRATIVE_ROLES.join(', ')}.`,
  'Each chapter object must contain no, title, role, beat, targetWords, and endsOnTension, with only optional sourceFacts and holdBack beyond those required fields. targetWords must be a positive integer, not a string. title: a short, evocative title in the project language, without a "Chapter N" prefix. beat: one sentence stating what this chapter makes the viewer understand or feel that the previous one did not.',
  SOURCE_FACT_CONTRACT,
  'Example chapter: {"no":1,"title":"<short title in the project language>","role":"hook","beat":"<one sentence: what this chapter achieves>","targetWords":300,"endsOnTension":true}.',
  'Each openLoop object must contain exactly question, plantedInChapter, and resolvedInChapter; no extra keys. plantedInChapter and resolvedInChapter are positive integers, not strings. question: phrase it as the question the viewer wants answered. Plant only a few genuine open loops (typically two to four, fewer for a short video) and answer each one in a later chapter.',
  'Example openLoop: {"question":"<question the viewer wants answered>","plantedInChapter":1,"resolvedInChapter":3}.',
].join(' ');
const EXPANSION_LENGTH_CONTRACT = 'styleNote max 500 chars, chapterSummary max 250 chars, avoidRepeating max 5 items each max 80 chars, persistentFactsNext max 5 items each max 120 chars.';
const OUTLINE_QUALITY_CONTRACT = `Order the chapters so each one changes what the viewer understands and raises the next question. Set endsOnTension to true where a chapter should pull the viewer into the next one and to false for the final chapter. Sum targetWords to the total narration budget within 2%, and verify the exact sum before returning JSON. For hubris-trap, keep each role's targetWords share within 5 percentage points of its five-act target. Plant roughly one open loop per two to three chapters (for N chapters, use ceil(N/3) through ceil(N/2) loops when N is at least 3); reference existing chapters and plant each before resolving it. Resolve every loop before the final chapter, except a final reflection resolved in a chapter with role resolution. ${SOURCE_FACT_CONTRACT}`;
const CHAPTER_WRITING_CONTRACT = `paragraphs: write only this chapter's narration. Each paragraph becomes one scene, so keep each paragraph to one visual moment and one thought. Land within about 10% of Target words; falling short makes the video shorter than planned. Continue from the previous chapter without recapping it, do not reuse anything listed under Avoid repeating, stay consistent with Persistent facts, and plant or resolve the listed open loops where this chapter's beat calls for it, without announcing them. If Ends on tension is yes, close on a line that pulls the viewer into the next chapter; if no, close cleanly. chapterSummary: one or two sentences on what this chapter established or revealed, so later chapters do not repeat it. avoidRepeating: images, phrases, or reveals already used that later chapters must not reuse. styleNote: a compact note on the visual and tonal motifs that should recur.`;
const MANUAL_WRITING_CONTRACT = `Each chapter's paragraphs are the finished narration: each paragraph becomes one scene (one visual moment, one thought), and the paragraphs of a chapter together should land within about 10% of that chapter's targetWords. Continue each chapter from the previous one without recapping it, plant each open loop in its plantedInChapter and answer it in its resolvedInChapter without announcing it, and when endsOnTension is true close the chapter on a line that pulls the viewer into the next one. Keep the sum of targetWords within 2% of the project budget; for hubris-trap keep each act within 5 percentage points of the role share. Use optional sourceFacts and holdBack with the same citation and grounding rules as the automatic outline; never invent a fact to fill a length gap. ${SOURCE_FACT_CONTRACT} Return one JSON object only, with no commentary before or after it.`;
const REGENERATION_CONTRACT = `Apply the Instruction to the current paragraphs according to the Regeneration level. light: keep the structure, order, and most sentences, and change only what the instruction needs. medium: rewrite the weak paragraphs and smooth the flow, keeping the facts, the paragraph order, and the chapter's beat. rewrite: write the chapter again from its role and beat, keeping the established facts, the open loops, and Target words. At every level keep each paragraph to one visual moment, stay consistent with Persistent facts, do not repeat anything listed under Avoid repeating, do not invent facts that the current text or the given context does not support, and keep the closing line consistent with Ends on tension. If the instruction conflicts with established facts, keep the facts and make the closest safe change.`;
const VISUAL_PROMPT_CONTRACT = `visualPrompt: write it in English even when the narration is in another language, because image and video generators follow English best. Describe one still image the viewer sees while the narration plays: the subject and what it is doing, the setting with era-specific details (clothing, architecture, vehicles, tools), the shot type and camera angle, the light, and the mood. Make every prompt reflect the required visual style and stand on its own, because each prompt is sent to the generator separately: repeat the identifying details of recurring characters, places, and objects (age, clothing, build, colors) and keep them identical wherever they reappear. Do not use the names of real people; describe their role, age, clothing, and build instead, and favor compositions that do not depend on a recognizable face. Show violence with restraint (aftermath, silhouettes, distance), never in graphic detail. Never request readable text, captions, logos, labels, or watermarks inside the image. Vary the shot type across consecutive scenes (wide, medium, close detail) so the sequence has rhythm, and keep the main subject away from the lower-right corner, where watermarks or a channel logo may sit. motionPrompt describes only what moves, not how the image looks. styleNote: a compact continuity note (palette, the look of recurring characters, recurring locations) that later chapters will reuse.`;
const SCENE_SPLIT_CONTRACT = 'Cut only at natural pauses: prefer sentence ends, then clause boundaries, and never inside a name, a number with its unit, a date, or a quoted phrase. Start a new chunk only when the picture on screen should change (a new subject, place, time, or action); a narration that describes one continuous moment stays a single chunk. Avoid fragments of only a few words.';
const QA_FIX_GUIDANCE = 'For every issue, also include when you can: paragraph (the 1-based paragraph number inside that chapter), quote (an exact, verbatim excerpt of at most 240 characters from that paragraph; never paraphrase, never merge two places), and fixInstruction (one concrete instruction for fixing exactly that spot, written in the project language, naming what to remove, narrow or rewrite). Add replacement only when the fix is a local sentence-level edit that you can write now: the full replacement text for the quote, or an empty string to delete it. A replacement may use only facts that appear in the supplied chapters or reference material; never add numbers, names, dates or quotations of your own, and never write a hedge like "theo một nguồn" without naming the source. For structural problems (weak hook, flat pacing, premature reveal, unresolved loop, weak payoff, dead chapter), give fixInstruction but no replacement. If you are not sure of the exact quote or paragraph, omit those fields instead of guessing.';
const QA_RUBRIC_CONTRACT = `Report only real, specific problems: if the script is clean, return {"issues":[]}, and prefer the most important issues over an exhaustive list. reason: one or two sentences naming what is wrong and where, quoting a short phrase from the chapter when it helps. severity: high = a factual contradiction, a broken setup or payoff, or a problem that would make viewers stop watching; medium = clearly weakens the video; low = polish. Issue types: REPETITION = the same information, image, or phrasing returns without adding anything; CONTRADICTION = two statements cannot both be true; DEAD_CHAPTER = the chapter does not move the story or the answer to the core question; POSSIBLE_FILLER = removing the chapter would not measurably hurt the video; WEAK_HOOK = the opening does not deliver the openingHook or the stakes; FLAT_PACING = a long stretch with no change in stakes, tempo, or information; PREMATURE_REVEAL = a payoff arrives before its setup has landed; UNRESOLVED_LOOP = an open loop is never answered or is answered in the wrong place; WEAK_PAYOFF = the answer is less satisfying than the question promised; AWKWARD_TRANSITION = the join between chapters is abrupt or confusing; TONE_DRIFT = the voice moves away from the preset's tone; CREDIBILITY_RISK = a claim is unsupported, overprecise, or likely wrong. Choose suggestedAction to match: REMOVE_DUPLICATION for repetition, SHORTEN for filler and flat pacing, MOVE_REVEAL for premature reveals, REVIEW_FACT for contradiction and credibility risk, REGENERATE when the chapter needs rewriting. ${QA_FIX_GUIDANCE}`;

type RegenerationPromptContext = {
  coreQuestion: string;
  openingHook: string | null;
  openLoops: readonly (OpenLoop | string)[];
  previousChapterSummary: string | null;
  previousAvoidRepeating: string[];
  previousPersistentFacts: string[];
};

function version(preset: ScriptPreset): string {
  return `script-prompt-v4/${preset.id}@${preset.version}`;
}

function qaVersion(preset: ScriptPreset): string {
  return `qa-prompt-v2/${preset.id}@${preset.version}`;
}

function language(project: ProjectDetail): string {
  return project.language === 'vi' ? 'Vietnamese' : 'English';
}

function systemMessage(preset: ScriptPreset, contract: string): string {
  return [
    'You are an experienced editor and writer on a professional video-production pipeline. Follow the task contract exactly and return only valid JSON. Do not use markdown fences, headings, or prose outside the JSON. Write every viewer-facing text field (titles, narration, beats, summaries, hooks, review reasons) in the project language named in the user message, keep JSON keys exactly as specified, and use only facts supported by the brief and references: never invent figures, dates, quotes, or motives.',
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
  const chapterCount = project.chapterCount ?? recommendScriptChapterCount(project.targetDurationSec);
  const count = `exactly ${chapterCount} chapters`;
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
    system: systemMessage(preset, `Return one JSON outline object with non-empty coreQuestion, openingHook, chapters, openLoops, and the preset-specific motif rule. ${SCRIPT_STRUCTURE_CONTRACT} coreQuestion must name the central question or problem the whole video answers. openingHook must be the actual candidate opening line or idea for the video, not a description of one. ${shape} ${weighting} ${OUTLINE_QUALITY_CONTRACT}`),
    user: [
      `Project title: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Language: ${language(project)}`,
      `Total narration word budget: ${Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE)} words; the sum of all targetWords must be within 2% of this budget.`,
      `Create ${count}; chapter count must be exact.`,
    ].join('\n'),
    promptVersion: version(preset),
  };
}

export function buildChapterExpansionPrompt(input: ChapterExpansionPromptInput): BuiltPrompt {
  const { project, chapter, coreQuestion, openingHook, previousChapterSummary, previousAvoidRepeating, previousPersistentFacts, openLoops, styleNote } = input;
  const preset = loadScriptPreset(project.scriptPresetId);
  return {
    system: systemMessage(preset, `Return one JSON object with paragraphs (string array), styleNote (string), chapterSummary (string), avoidRepeating (array), and persistentFactsNext (array). ${EXPANSION_LENGTH_CONTRACT} ${PERSISTENT_FACTS_INSTRUCTION} ${CHAPTER_WRITING_CONTRACT}`),
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
  const chapterCount = project.chapterCount ?? recommendScriptChapterCount(project.targetDurationSec);
  return {
    system: systemMessage(preset, `Return one complete script document with non-empty coreQuestion and openingHook at the document root, plus chapters containing no, title, role, beat, positive targetWords, endsOnTension, and paragraphs; also include openLoops and the preset-specific motif rule. ${SCRIPT_STRUCTURE_CONTRACT} coreQuestion must name the central question or problem the whole video answers. openingHook must be the actual candidate opening line or idea for the video, not a description of one. ${MANUAL_WRITING_CONTRACT}`),
    user: [
      `Write the complete script document for project: ${project.title}`,
      `Brief: ${project.brief}`,
      `References: ${project.referencesText || '(none)'}`,
      `Language: ${language(project)}`,
      `Total narration word budget: ${Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE)} words; the sum of all targetWords must be within 2% of this budget.`,
      `Use exactly ${chapterCount} chapters; chapter count must be exact.`,
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
    system: systemMessage(preset, `Rewrite one chapter and return one JSON object with paragraphs (string array), chapterSummary (string, at most 250 characters), avoidRepeating (array, at most 5 items of at most 80 characters each), and persistentFactsNext (array, at most 5 items of at most 120 characters each). ${PERSISTENT_FACTS_INSTRUCTION} ${REGENERATION_CONTRACT}`),
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
    system: systemMessage(scriptPreset, "Return one JSON object with styleNote (at most 500 characters) and prompts, an array with exactly one {sceneIndex, visualPrompt, sfxPrompt, motionPrompt} object per input scene. Use positive one-based indexes and non-empty visual prompts. sfxPrompt must be 2-4 short English Freesound search phrases for non-speech, non-music ambience and sound effects only, comma-separated and ordered most important first. Do not include human voice, speech, shouting, war cries, crowd chanting, singing, or music. If nothing audible adds value to a scene, use an empty string. motionPrompt should be a short English animation instruction of roughly one or two sentences describing a camera move and what the subject does, intended for image-to-video generation. Only write a non-empty motionPrompt when that scene's asset type is video; return an empty string for image scenes. Existing visual prompts, SFX prompts, and motion prompts are references; preserve their intent. " + VISUAL_PROMPT_CONTRACT),
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
    promptVersion: `visual-prompt-v2/${visualPreset.id}@${visualPreset.version}`,
  };
}

export function buildSceneSplitPrompt(input: SceneSplitPromptInput): BuiltPrompt {
  const { project, chapter, scenes } = input;
  return {
    system: 'You select visual cut points in existing narration. Return only valid JSON with a scenes array. For every supplied sceneIndex, return one object containing that exact sceneIndex and chunks, an array of non-empty strings. Each chunk must be an exact contiguous substring of its source narration. Do not reword, add, remove, or otherwise modify any narration text. Preserve the source text in order. Echo each supplied sceneIndex exactly once; do not invent, omit, duplicate, or renumber indexes. ' + SCENE_SPLIT_CONTRACT,
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
    promptVersion: 'scene-split-v2',
  };
}

export function buildQaPrompt(project: ProjectDetail): BuiltPrompt {
  const preset = loadScriptPreset(project.scriptPresetId);
  const issueTypes = QA_ISSUE_TYPES.join(', ');
  const actions = QA_SUGGESTED_ACTIONS.join(', ');
  return {
    system: systemMessage(preset, `Return one strict JSON object: {"issues":[...]}. Each issue must contain only chapter (positive integer), type (${issueTypes}), severity (low, medium, or high), reason, and suggestedAction (${actions}), plus optional paragraph (positive integer), quote (string, max 240 characters), fixInstruction (string, max 300 characters), and replacement (string, max 600 characters). Do not return a score, suggestedFix, or any other field. Detect and flag issues only; do not rewrite any text. ${QA_RUBRIC_CONTRACT}`),
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
    promptVersion: qaVersion(preset),
  };
}
