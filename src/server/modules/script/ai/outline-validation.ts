import { NARRATIVE_ROLES, getReferenceCoverage } from '../../../../contracts/script';
import type { ProjectDetail, ScriptPresetId } from '../../../../contracts/project';
import { NARRATION_WORDS_PER_MINUTE } from '../../../../contracts/script';
import { AppError } from '../../../shared/errors';
import { SCRIPT_PRESET_CONFIG } from './presets/config';
import type { ScriptOutline } from './output-schema';

export type OutlineProjectContext = Pick<ProjectDetail, 'targetDurationSec' | 'chapterCount' | 'referencesText' | 'scriptPresetId'>;
export type OutlineInspection = { errors: string[]; warnings: string[] };

const ACT_SHARE_TOLERANCE_PCT_POINTS = 5;
const OUTLINE_WORD_BUDGET_TOLERANCE_PCT = 2;
const CHAPTER_WORD_CEILING = 600;
const THIN_SOURCE_MIN_FACTS = 2;
const THIN_SOURCE_MIN_TARGET = 150;

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

export function recommendScriptChapterCount(targetDurationSec: number): number {
  const targetMinutes = targetDurationSec / 60;
  return Math.max(3, Math.min(10, Math.round(targetMinutes / 2.5)));
}

export function getOutlineOutputBudgets(chapterCount: number, referenceCharacters: number, modelOutputTokenCap: number): {
  estimatedFactSlots: number;
  initial: number;
  retry: number;
} {
  const estimatedFactSlots = referenceCharacters > 0
    ? Math.min(10, Math.max(2, Math.ceil(referenceCharacters / (chapterCount * 750))))
    : 0;
  const calculated = 2000 + chapterCount * (350 + estimatedFactSlots * 75 + 4 * 50);
  const initial = Math.min(32_000, modelOutputTokenCap, calculated);
  return {
    estimatedFactSlots,
    initial,
    retry: Math.min(modelOutputTokenCap, Math.ceil(initial * 1.5)),
  };
}

function projectWordBudget(project: OutlineProjectContext): number {
  return Math.round(project.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE);
}

function budgetDifferenceMessage(plannedWords: number, budgetWords: number): string {
  const difference = plannedWords - budgetWords;
  const differencePct = budgetWords ? round(difference / budgetWords * 100) : 0;
  const adjustment = -difference;
  const differencePctText = `${differencePct > 0 ? '+' : ''}${differencePct.toFixed(1)}`;
  return `targetWords total is ${plannedWords.toLocaleString('en-US')}; budget is ${budgetWords.toLocaleString('en-US')} words (difference ${signed(difference)}, ${differencePctText}%). Adjust the outline by exactly ${signed(adjustment)} words and keep the total within ±${OUTLINE_WORD_BUDGET_TOLERANCE_PCT}% of budget.`;
}

function actShareDiagnostics(outline: ScriptOutline, presetId: ScriptPresetId): Array<{ act: number; role: string; actualPct: number; targetPct: number; differencePctPoints: number }> {
  const weighting = SCRIPT_PRESET_CONFIG[presetId].actWeighting;
  if (!weighting) return [];
  const totalWords = outline.chapters.reduce((sum, chapter) => sum + chapter.targetWords, 0);
  return NARRATIVE_ROLES.map((role, index) => {
    const roleWords = outline.chapters.filter((chapter) => chapter.role === role).reduce((sum, chapter) => sum + chapter.targetWords, 0);
    const actualPct = totalWords ? roleWords / totalWords * 100 : 0;
    const targetPct = weighting[index]!;
    return { act: index + 1, role, actualPct, targetPct, differencePctPoints: actualPct - targetPct };
  });
}

function sourceFactErrors(outline: ScriptOutline, referencesText: string): string[] {
  const referenceTags = new Set([...referencesText.matchAll(/\[(\d+)\]/gu)].map((match) => match[1]!));
  if (referenceTags.size === 0) return [];
  const errors: string[] = [];
  for (const chapter of outline.chapters) {
    for (const [index, fact] of (chapter.sourceFacts ?? []).entries()) {
      const match = fact.match(/\[(\d+)\]$/u);
      if (!match || !referenceTags.has(match[1]!)) {
        errors.push(`Chapter ${chapter.no} sourceFacts[${index}] must end with a source tag that exists in References (for example [1]).`);
      }
    }
  }
  return errors;
}

export function inspectScriptOutline(outline: ScriptOutline, project: OutlineProjectContext): OutlineInspection {
  const errors: string[] = [];
  const warnings: string[] = [];
  const chapterCount = outline.chapters.length;
  const expectedCount = project.chapterCount ?? recommendScriptChapterCount(project.targetDurationSec);
  if (chapterCount !== expectedCount) errors.push(`Outline must contain exactly ${expectedCount} chapters; received ${chapterCount}.`);
  if (outline.chapters.some((chapter, index) => chapter.no !== index + 1)) {
    errors.push(`Chapter numbers must be contiguous from 1 through ${chapterCount}.`);
  }

  const budgetWords = projectWordBudget(project);
  const plannedWords = outline.chapters.reduce((sum, chapter) => sum + chapter.targetWords, 0);
  if (budgetWords > 0 && Math.abs(plannedWords - budgetWords) / budgetWords > OUTLINE_WORD_BUDGET_TOLERANCE_PCT / 100) {
    errors.push(budgetDifferenceMessage(plannedWords, budgetWords));
  }

  const minLoops = chapterCount >= 3 ? Math.ceil(chapterCount / 3) : 0;
  const maxLoops = Math.max(1, Math.ceil(chapterCount / 2));
  if (outline.openLoops.length < minLoops || outline.openLoops.length > maxLoops) {
    errors.push(`Expected ${minLoops}–${maxLoops} open loops for ${chapterCount} chapters; received ${outline.openLoops.length}.`);
  }
  for (const [index, loop] of outline.openLoops.entries()) {
    if (loop.plantedInChapter < 1 || loop.plantedInChapter > chapterCount || loop.resolvedInChapter < 1 || loop.resolvedInChapter > chapterCount) {
      errors.push(`Open loop ${index + 1} must reference chapters between 1 and ${chapterCount}.`);
      continue;
    }
    if (loop.plantedInChapter >= loop.resolvedInChapter) errors.push(`Open loop ${index + 1} must be planted before it is resolved.`);
    if (loop.resolvedInChapter === chapterCount && outline.chapters[chapterCount - 1]?.role !== 'resolution') {
      errors.push('An open loop resolved in the last chapter requires that chapter to have the resolution role.');
    }
  }
  if (outline.openLoops.filter((loop) => loop.resolvedInChapter === chapterCount).length > 1) {
    errors.push('At most one final-reflection open loop may resolve in the last chapter.');
  }

  if (project.scriptPresetId === 'hubris-trap') {
    const actShares = actShareDiagnostics(outline, project.scriptPresetId);
    if (chapterCount < NARRATIVE_ROLES.length) {
      warnings.push(`The five hubris-trap act shares cannot all be represented with ${chapterCount} chapters; strict ±${ACT_SHARE_TOLERANCE_PCT_POINTS} pp validation is suspended below five chapters.`);
    } else {
      for (const act of actShares) {
        if (Math.abs(act.differencePctPoints) > ACT_SHARE_TOLERANCE_PCT_POINTS) {
          errors.push(`Act ${act.act} (${act.role}) is ${act.actualPct.toFixed(1)}%; target ${act.targetPct}% ±${ACT_SHARE_TOLERANCE_PCT_POINTS} pp.`);
        }
      }
    }
  }
  errors.push(...sourceFactErrors(outline, project.referencesText));

  for (const chapter of outline.chapters) {
    if (chapter.targetWords > CHAPTER_WORD_CEILING) {
      warnings.push(`Chapter ${chapter.no} target is ${chapter.targetWords} words, above the ${CHAPTER_WORD_CEILING}-word (4-minute) ceiling.`);
    }
    if ((chapter.sourceFacts?.length ?? 0) < THIN_SOURCE_MIN_FACTS && chapter.targetWords > THIN_SOURCE_MIN_TARGET) {
      warnings.push(`Chapter ${chapter.no} is thin-source: fewer than ${THIN_SOURCE_MIN_FACTS} source facts for a target above ${THIN_SOURCE_MIN_TARGET} words.`);
    }
  }
  return { errors, warnings };
}

export function validateScriptOutline(outline: ScriptOutline, project: OutlineProjectContext): string[] {
  const result = inspectScriptOutline(outline, project);
  if (result.errors.length > 0) {
    throw new AppError(`AI returned invalid script structure: ${result.errors.slice(0, 3).join('; ')}`, 422, 'SCRIPT_PARSE_ERROR');
  }
  return result.warnings;
}

export function getManualOutlineWarnings(outline: ScriptOutline, project: OutlineProjectContext): string[] {
  const warnings: string[] = [];
  const budget = projectWordBudget(project);
  const planned = outline.chapters.reduce((sum, chapter) => sum + chapter.targetWords, 0);
  if (budget > 0 && Math.abs(planned - budget) / budget > OUTLINE_WORD_BUDGET_TOLERANCE_PCT / 100) {
    warnings.push(budgetDifferenceMessage(planned, budget));
  }
  if (project.scriptPresetId === 'hubris-trap') {
    for (const act of actShareDiagnostics(outline, project.scriptPresetId)) {
      if (Math.abs(act.differencePctPoints) > ACT_SHARE_TOLERANCE_PCT_POINTS) {
        warnings.push(`Act ${act.act} (${act.role}) is ${act.actualPct.toFixed(1)}%; target ${act.targetPct}% ±${ACT_SHARE_TOLERANCE_PCT_POINTS} pp.`);
      }
    }
  }
  return warnings;
}

export function getShortReferenceWarning(project: Pick<ProjectDetail, 'referencesText' | 'targetDurationSec'>): string | null {
  const coverage = getReferenceCoverage(project.referencesText, project.targetDurationSec);
  if (!coverage.shouldWarn) return null;
  return `References are short: ${coverage.referenceCharacters} characters for ${coverage.targetMinutes} target minutes (${coverage.charactersPerMinute} characters/min; warning threshold 500). Generation will continue.`;
}
