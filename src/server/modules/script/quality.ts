import { SCRIPT_PRESET_CONFIG } from './ai/presets/config';
import { getDefaultAiModelId } from '../../../contracts/ai-models';
import type { AiProvider, ScriptPresetId } from '../../../contracts/project';
import { countNarrationWords, NARRATIVE_ROLES, NARRATION_WORDS_PER_MINUTE, type ChapterDoc, type ScriptQualitySummary } from '../../../contracts/script';

type QualityChapter = Pick<ChapterDoc, 'no' | 'title' | 'role' | 'targetWords' | 'paragraphs'> & {
  sourceFacts?: string[];
};

export type ScriptQualityInput = {
  id: string;
  title: string;
  brief: string;
  referencesText: string;
  scriptPresetId: ScriptPresetId;
  targetDurationSec: number;
  aiProvider?: AiProvider;
  aiModel?: string;
  chapters: QualityChapter[];
  openLoops: Array<{ question: string; plantedInChapter: number; resolvedInChapter: number }>;
};

export type ScriptQualityReport = {
  project: {
    id: string;
    title: string;
    provider: string | null;
    model: string | null;
    targetDurationSec: number;
    chapterCount: number;
    scriptPresetId: ScriptPresetId;
  };
  length: {
    targetWords: number;
    totalWords: number;
    differenceWords: number;
    deviationPct: number;
    estimatedDurationSec: number;
    maxChapterDeviationPct: number;
    chapters: Array<{
      no: number;
      title: string;
      words: number;
      targetWords: number;
      differenceWords: number;
      deviationPct: number;
      estimatedDurationSec: number;
    }>;
  };
  grounding: {
    candidateCount: number;
    unsupportedCount: number;
    unsupportedShare: number;
    unsupported: Array<{ token: string; kind: 'number-or-date' | 'capitalized-phrase'; chapterNo: number; paragraphNo: number }>;
  };
  repetition: {
    repeatedSixGrams: Array<{ phrase: string; chapterNos: number[] }>;
    repeatedParagraphOpeners: Array<{ opener: string; occurrences: number; chapterNos: number[] }>;
    nearDuplicateParagraphs: Array<{
      chapterNoA: number;
      paragraphNoA: number;
      chapterNoB: number;
      paragraphNoB: number;
      similarity: number;
    }>;
    nearDuplicateThreshold: number;
  };
  arc: {
    actShares: Array<{ act: number; role: string; words: number; actualPct: number; targetPct: number; differencePctPoints: number }>;
    loops: Array<{
      question: string;
      plantedInChapter: number;
      resolvedInChapter: number;
      mentionedChapterNos: number[];
      plantedTermFound: boolean;
      resolvedTermFound: boolean;
    }>;
  };
  structure: {
    sentenceCount: number;
    sentencesOver30Words: number;
    sentencesOver30Share: number;
    chapters: Array<{ chapterNo: number; paragraphCount: number; longestSentenceWords: number; sentencesOver30Words: number; sentenceCount: number }>;
  };
  sourceUsage: Array<{ chapterNo: number; facts: number; used: number; share: number }>;
};

const WORDS_PER_MINUTE = 150;
const MANUAL_LENGTH_MIN_PCT = 85;
const MANUAL_LENGTH_MAX_PCT = 115;
const MANUAL_BUDGET_TOLERANCE_PCT = 2;
const MANUAL_ACT_TOLERANCE_PCT_POINTS = 5;
const NEAR_DUPLICATE_THRESHOLD = 0.85;
const NAME_OR_NUMBER_RE = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*){0,3}/gu;
const NUMERIC_RE = /(?<![\p{L}\p{N}])\d{1,4}(?:[.,:/-]\d{1,4})*(?:\s?%?)(?![\p{L}\p{N}])/gu;
const SENTENCE_RE = /[^.!?…。！？]+[.!?…。！？]?/gu;
const LOOP_STOP_WORDS = new Set(['about', 'after', 'all', 'and', 'are', 'before', 'but', 'can', 'does', 'for', 'from', 'how', 'into', 'is', 'it', 'of', 'on', 'or', 'the', 'this', 'to', 'was', 'what', 'when', 'where', 'who', 'will', 'with', 'would', 'cau', 'cho', 'co', 'cua', 'da', 'de', 'den', 'duoc', 'gi', 'la', 'ma', 'mot', 'nao', 'nhung', 'sao', 'se', 'tai', 'the', 'thanh', 'trong', 'va', 'vi', 'voi']);
const FACT_STOP_WORDS = new Set(['about', 'after', 'all', 'and', 'are', 'before', 'but', 'can', 'does', 'for', 'from', 'into', 'is', 'it', 'of', 'on', 'or', 'the', 'this', 'to', 'was', 'with', 'cau', 'cho', 'co', 'cua', 'da', 'de', 'den', 'duoc', 'la', 'ma', 'mot', 'nhung', 'tai', 'trong', 'va', 'vi', 'voi']);
const ACT_ROLES = ['hook', 'context', 'rising', 'climax', 'resolution'] as const;

export function normalizeQualityText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/gu, (letter) => letter === 'Đ' ? 'D' : 'd')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function words(text: string): string[] {
  return normalizeQualityText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function round(value: number, decimalPlaces = 1): number {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

function sentenceWordCounts(paragraph: string): number[] {
  return (paragraph.match(SENTENCE_RE) ?? [paragraph])
    .map((sentence) => words(sentence).length)
    .filter((count) => count > 0);
}

function paragraphOpener(paragraph: string): string {
  return words(paragraph).slice(0, 6).join(' ');
}

function jaccard(a: string, b: string): number {
  const left = new Set(words(a));
  const right = new Set(words(b));
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
}

function contentTerms(text: string, maxTerms: number): string[] {
  const withoutTags = text.replace(/\[\d+\]/gu, ' ');
  return [...new Set(words(withoutTags).filter((term) => term.length > 2 && !FACT_STOP_WORDS.has(term)))].slice(0, maxTerms);
}

function loopTerms(text: string): string[] {
  return [...new Set(words(text).filter((term) => term.length > 2 && !/\d/u.test(term) && !LOOP_STOP_WORDS.has(term)))];
}

function collectGroundingCandidates(
  input: ScriptQualityInput,
  corpus: string,
): { candidateCount: number; unsupported: ScriptQualityReport['grounding']['unsupported'] } {
  const unsupported: ScriptQualityReport['grounding']['unsupported'] = [];
  let candidateCount = 0;
  for (const chapter of input.chapters) {
    for (const [paragraphIndex, paragraph] of chapter.paragraphs.entries()) {
      const candidates = new Map<string, 'number-or-date' | 'capitalized-phrase'>();
      for (const match of paragraph.matchAll(NUMERIC_RE)) candidates.set(match[0].trim(), 'number-or-date');
      for (const match of paragraph.matchAll(NAME_OR_NUMBER_RE)) {
        const token = match[0].trim();
        if (/\p{L}/u.test(token)) candidates.set(token, 'capitalized-phrase');
      }
      candidateCount += candidates.size;
      for (const [token, kind] of candidates) {
        const normalizedToken = normalizeQualityText(token);
        if (normalizedToken && !corpus.includes(normalizedToken)) {
          unsupported.push({ token, kind, chapterNo: chapter.no, paragraphNo: paragraphIndex + 1 });
        }
      }
    }
  }
  return { candidateCount, unsupported };
}

export function analyzeScriptQuality(input: ScriptQualityInput): ScriptQualityReport {
  const wordBudget = Math.round(input.targetDurationSec / 60 * WORDS_PER_MINUTE);
  const chapterMetrics = input.chapters.map((chapter) => {
    const wordCount = chapter.paragraphs.reduce((count, paragraph) => count + words(paragraph).length, 0);
    const targetWords = chapter.targetWords ?? (input.chapters.length ? Math.round(wordBudget / input.chapters.length) : 0);
    const differenceWords = wordCount - targetWords;
    return {
      no: chapter.no,
      title: chapter.title,
      words: wordCount,
      targetWords,
      differenceWords,
      deviationPct: targetWords ? round(differenceWords / targetWords * 100) : 0,
      estimatedDurationSec: Math.round(wordCount / WORDS_PER_MINUTE * 60),
    };
  });
  const totalWords = chapterMetrics.reduce((sum, chapter) => sum + chapter.words, 0);
  const differenceWords = totalWords - wordBudget;
  const corpus = normalizeQualityText(`${input.brief}\n${input.referencesText}`);

  const grounding = collectGroundingCandidates(input, corpus);
  const normalizedChapters = input.chapters.map((chapter) => ({ no: chapter.no, text: normalizeQualityText(chapter.paragraphs.join(' ')) }));

  const sixGramChapters = new Map<string, Set<number>>();
  for (const chapter of input.chapters) {
    const tokens = words(chapter.paragraphs.join(' '));
    for (let index = 0; index <= tokens.length - 6; index += 1) {
      const phrase = tokens.slice(index, index + 6).join(' ');
      const chapterNos = sixGramChapters.get(phrase) ?? new Set<number>();
      chapterNos.add(chapter.no);
      sixGramChapters.set(phrase, chapterNos);
    }
  }
  const repeatedSixGrams = [...sixGramChapters]
    .filter(([, chapterNos]) => chapterNos.size > 1)
    .map(([phrase, chapterNos]) => ({ phrase, chapterNos: [...chapterNos].sort((a, b) => a - b) }));

  const openerOccurrences = new Map<string, number[]>();
  for (const chapter of input.chapters) {
    for (const paragraph of chapter.paragraphs) {
      const opener = paragraphOpener(paragraph);
      if (!opener) continue;
      const occurrences = openerOccurrences.get(opener) ?? [];
      occurrences.push(chapter.no);
      openerOccurrences.set(opener, occurrences);
    }
  }
  const repeatedParagraphOpeners = [...openerOccurrences]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([opener, occurrences]) => ({ opener, occurrences: occurrences.length, chapterNos: [...new Set(occurrences)].sort((a, b) => a - b) }));

  const paragraphs = input.chapters.flatMap((chapter) => chapter.paragraphs.map((paragraph, index) => ({ chapterNo: chapter.no, paragraphNo: index + 1, text: paragraph })));
  const nearDuplicateParagraphs: ScriptQualityReport['repetition']['nearDuplicateParagraphs'] = [];
  for (let leftIndex = 0; leftIndex < paragraphs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paragraphs.length; rightIndex += 1) {
      const left = paragraphs[leftIndex]!;
      const right = paragraphs[rightIndex]!;
      const similarity = jaccard(left.text, right.text);
      if (similarity >= NEAR_DUPLICATE_THRESHOLD) {
        nearDuplicateParagraphs.push({
          chapterNoA: left.chapterNo,
          paragraphNoA: left.paragraphNo,
          chapterNoB: right.chapterNo,
          paragraphNoB: right.paragraphNo,
          similarity: round(similarity, 3),
        });
      }
    }
  }

  const actWeighting = SCRIPT_PRESET_CONFIG[input.scriptPresetId].actWeighting;
  const actShares = actWeighting
    ? ACT_ROLES.map((role, index) => {
      const roleWords = chapterMetrics
        .filter((chapter) => input.chapters.find((candidate) => candidate.no === chapter.no)?.role === role)
        .reduce((sum, chapter) => sum + chapter.words, 0);
      const actualPct = totalWords ? roleWords / totalWords * 100 : 0;
      return {
        act: index + 1,
        role,
        words: roleWords,
        actualPct: round(actualPct),
        targetPct: actWeighting[index]!,
        differencePctPoints: round(actualPct - actWeighting[index]!),
      };
    })
    : [];

  const loops = input.openLoops.map((loop) => {
    const terms = loopTerms(loop.question);
    const minimumMatchedTerms = Math.max(1, Math.ceil(terms.length * 0.35));
    const mentionedChapterNos = normalizedChapters
      .filter((chapter) => terms.length > 0 && terms.filter((term) => chapter.text.split(' ').includes(term)).length >= minimumMatchedTerms)
      .map((chapter) => chapter.no);
    return {
      question: loop.question,
      plantedInChapter: loop.plantedInChapter,
      resolvedInChapter: loop.resolvedInChapter,
      mentionedChapterNos,
      plantedTermFound: mentionedChapterNos.includes(loop.plantedInChapter),
      resolvedTermFound: mentionedChapterNos.includes(loop.resolvedInChapter),
    };
  });

  let sentenceCount = 0;
  let sentencesOver30Words = 0;
  const structureChapters = input.chapters.map((chapter) => {
    const lengths = chapter.paragraphs.flatMap(sentenceWordCounts);
    const chapterOver30 = lengths.filter((length) => length > 30).length;
    sentenceCount += lengths.length;
    sentencesOver30Words += chapterOver30;
    return {
      chapterNo: chapter.no,
      paragraphCount: chapter.paragraphs.length,
      longestSentenceWords: lengths.length ? Math.max(...lengths) : 0,
      sentencesOver30Words: chapterOver30,
      sentenceCount: lengths.length,
    };
  });

  const sourceUsage = input.chapters.flatMap((chapter) => {
    const facts = chapter.sourceFacts ?? [];
    if (facts.length === 0) return [];
    const narrationTerms = new Set(words(chapter.paragraphs.join(' ')));
    const used = facts.filter((fact) => {
      const terms = contentTerms(fact, 8);
      if (terms.length === 0) return false;
      const matchingTerms = terms.filter((term) => narrationTerms.has(term)).length;
      return matchingTerms >= Math.ceil(terms.length / 2);
    }).length;
    return [{ chapterNo: chapter.no, facts: facts.length, used, share: round(used / facts.length, 3) }];
  });

  return {
    project: {
      id: input.id,
      title: input.title,
      provider: input.aiProvider ?? null,
      model: input.aiModel ?? (input.aiProvider ? getDefaultAiModelId(input.aiProvider) : null),
      targetDurationSec: input.targetDurationSec,
      chapterCount: input.chapters.length,
      scriptPresetId: input.scriptPresetId,
    },
    length: {
      targetWords: wordBudget,
      totalWords,
      differenceWords,
      deviationPct: wordBudget ? round(differenceWords / wordBudget * 100) : 0,
      estimatedDurationSec: Math.round(totalWords / WORDS_PER_MINUTE * 60),
      maxChapterDeviationPct: chapterMetrics.length ? round(Math.max(...chapterMetrics.map((chapter) => Math.abs(chapter.deviationPct)))) : 0,
      chapters: chapterMetrics,
    },
    grounding: {
      candidateCount: grounding.candidateCount,
      unsupportedCount: grounding.unsupported.length,
      unsupportedShare: grounding.candidateCount ? round(grounding.unsupported.length / grounding.candidateCount, 3) : 0,
      unsupported: grounding.unsupported,
    },
    repetition: {
      repeatedSixGrams,
      repeatedParagraphOpeners,
      nearDuplicateParagraphs,
      nearDuplicateThreshold: NEAR_DUPLICATE_THRESHOLD,
    },
    arc: { actShares, loops },
    structure: {
      sentenceCount,
      sentencesOver30Words,
      sentencesOver30Share: sentenceCount ? round(sentencesOver30Words / sentenceCount, 3) : 0,
      chapters: structureChapters,
    },
    sourceUsage,
  };
}

type ManualQualityInput = {
  targetDurationSec: number;
  scriptPresetId: ScriptPresetId;
  chapters: Array<Pick<ChapterDoc, 'no' | 'title' | 'role' | 'targetWords' | 'paragraphs'>>;
};

export function summarizeManualScriptQuality(input: ManualQualityInput): ScriptQualitySummary {
  const targetWords = Math.round(input.targetDurationSec / 60 * NARRATION_WORDS_PER_MINUTE);
  const fallbackChapterTarget = input.chapters.length ? Math.round(targetWords / input.chapters.length) : 0;
  const chapters = input.chapters.map((chapter) => {
    const words = chapter.paragraphs.reduce((sum, paragraph) => sum + countNarrationWords(paragraph), 0);
    const chapterTargetWords = chapter.targetWords ?? fallbackChapterTarget;
    const differenceWords = words - chapterTargetWords;
    const exactTargetPercent = chapterTargetWords ? words / chapterTargetWords * 100 : 0;
    return {
      chapterNo: chapter.no,
      title: chapter.title,
      words,
      targetWords: chapterTargetWords,
      differenceWords,
      deviationPct: chapterTargetWords ? round(differenceWords / chapterTargetWords * 100) : 0,
      outsideLengthRange: exactTargetPercent < MANUAL_LENGTH_MIN_PCT || exactTargetPercent > MANUAL_LENGTH_MAX_PCT,
    };
  });
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.words, 0);
  const totalDifference = totalWords - targetWords;
  const exactTargetPercent = targetWords ? totalWords / targetWords * 100 : 0;
  const targetPercent = round(exactTargetPercent);
  const outsideLengthRange = exactTargetPercent < MANUAL_LENGTH_MIN_PCT || exactTargetPercent > MANUAL_LENGTH_MAX_PCT;
  const plannedWords = input.chapters.reduce((sum, chapter) => sum + (chapter.targetWords ?? fallbackChapterTarget), 0);
  const plannedDifferenceWords = plannedWords - targetWords;
  const exactPlannedDeviationPct = targetWords ? plannedDifferenceWords / targetWords * 100 : 0;
  const plannedDeviationPct = round(exactPlannedDeviationPct);
  const plannedBudgetWarning = targetWords > 0 && Math.abs(exactPlannedDeviationPct) > MANUAL_BUDGET_TOLERANCE_PCT;
  const weighting = SCRIPT_PRESET_CONFIG[input.scriptPresetId].actWeighting;
  const actShares = weighting
    ? NARRATIVE_ROLES.map((role, index) => {
      const words = chapters.filter((chapter) => input.chapters.find((candidate) => candidate.no === chapter.chapterNo)?.role === role)
        .reduce((sum, chapter) => sum + chapter.words, 0);
      const exactActualPct = totalWords ? words / totalWords * 100 : 0;
      const actualPct = round(exactActualPct);
      const targetPct = weighting[index]!;
      const exactDifferencePctPoints = exactActualPct - targetPct;
      const differencePctPoints = round(exactDifferencePctPoints);
      return { act: index + 1, role, actualPct, targetPct, differencePctPoints, outsideTolerance: Math.abs(exactDifferencePctPoints) > MANUAL_ACT_TOLERANCE_PCT_POINTS };
    })
    : [];
  const warnings = [
    ...(outsideLengthRange ? ['Total narration is outside 85–115% of the target word budget.'] : []),
    ...chapters.filter((chapter) => chapter.outsideLengthRange).map((chapter) => `Chapter ${chapter.chapterNo} is outside 85–115% of its target (${chapter.words}/${chapter.targetWords} words).`),
    ...(plannedBudgetWarning ? [`Planned targetWords total is ${plannedWords} words, ${plannedDeviationPct > 0 ? '+' : ''}${plannedDeviationPct}% from the ${targetWords}-word project budget (tolerance ±${MANUAL_BUDGET_TOLERANCE_PCT}%).`] : []),
    ...actShares.filter((act) => act.outsideTolerance).map((act) => `Act ${act.act} (${act.role}) is ${act.actualPct}%; target ${act.targetPct}% ±${MANUAL_ACT_TOLERANCE_PCT_POINTS} pp.`),
  ];
  return {
    totalWords,
    targetWords,
    differenceWords: totalDifference,
    targetPercent,
    outsideLengthRange,
    plannedWords,
    plannedDifferenceWords,
    plannedDeviationPct,
    plannedBudgetWarning,
    actShares,
    chapters,
    warnings,
  };
}

export function formatQualityReport(report: ScriptQualityReport, format: 'md' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [
    `# Script quality report: ${report.project.title}`,
    '',
    `- Project ID: ${report.project.id}`,
    `- Provider/model: ${report.project.provider ?? 'unknown'} / ${report.project.model ?? 'unknown'}`,
    `- Target: ${report.project.targetDurationSec}s (${report.length.targetWords} words), ${report.project.chapterCount} chapters, preset ${report.project.scriptPresetId}`,
    '',
    '## Length',
    '',
    `- Total: ${report.length.totalWords} / ${report.length.targetWords} words (${report.length.differenceWords >= 0 ? '+' : ''}${report.length.differenceWords}; ${report.length.deviationPct}%)`,
    `- Estimated narration: ${report.length.estimatedDurationSec}s; maximum chapter deviation: ${report.length.maxChapterDeviationPct}%`,
    '',
    '| Chapter | Words / target | Difference | Deviation | Estimated seconds |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.length.chapters.map((chapter) => `| ${chapter.no}. ${chapter.title} | ${chapter.words} / ${chapter.targetWords} | ${chapter.differenceWords} | ${chapter.deviationPct}% | ${chapter.estimatedDurationSec} |`),
    '',
    '## Grounding',
    '',
    `- Unsupported token candidates: ${report.grounding.unsupportedCount} / ${report.grounding.candidateCount} (${round(report.grounding.unsupportedShare * 100)}%). Sentence-initial capitalization, Vietnamese number words and name variants can cause false positives or misses.`,
    ...report.grounding.unsupported.map((item) => `- ${item.token} (${item.kind}), chapter ${item.chapterNo}, paragraph ${item.paragraphNo}`),
    '',
    '## Repetition',
    '',
    `- Repeated cross-chapter 6-grams: ${report.repetition.repeatedSixGrams.length}`,
    ...report.repetition.repeatedSixGrams.slice(0, 20).map((item) => `- “${item.phrase}” in chapters ${item.chapterNos.join(', ')}`),
    `- Repeated paragraph openers: ${report.repetition.repeatedParagraphOpeners.length}`,
    ...report.repetition.repeatedParagraphOpeners.map((item) => `- “${item.opener}” repeated ${item.occurrences} times in chapters ${item.chapterNos.join(', ')}`),
    `- Near-duplicate paragraph pairs (Jaccard ≥ ${report.repetition.nearDuplicateThreshold}): ${report.repetition.nearDuplicateParagraphs.length}`,
    ...report.repetition.nearDuplicateParagraphs.map((item) => `- Ch ${item.chapterNoA} p${item.paragraphNoA} ↔ ch ${item.chapterNoB} p${item.paragraphNoB}: ${item.similarity}`),
    '',
    '## Arc and loops',
    '',
    ...(report.arc.actShares.length ? [
      '| Act | Role | Words | Actual | Target | Difference |',
      '| ---: | --- | ---: | ---: | ---: | ---: |',
      ...report.arc.actShares.map((act) => `| ${act.act} | ${act.role} | ${act.words} | ${act.actualPct}% | ${act.targetPct}% | ${act.differencePctPoints} pp |`),
    ] : ['No act-weighting target for this preset.']),
    ...report.arc.loops.map((loop) => `- Loop “${loop.question}”: planted ch ${loop.plantedInChapter} (${loop.plantedTermFound ? 'term found' : 'term absent'}), resolved ch ${loop.resolvedInChapter} (${loop.resolvedTermFound ? 'term found' : 'term absent'}); mentions in ${loop.mentionedChapterNos.join(', ') || 'no chapters'}.`),
    '',
    '## Structure and source usage',
    '',
    `- Sentences over 30 words: ${report.structure.sentencesOver30Words} / ${report.structure.sentenceCount} (${round(report.structure.sentencesOver30Share * 100)}%).`,
    ...report.structure.chapters.map((chapter) => `- Chapter ${chapter.chapterNo}: ${chapter.paragraphCount} paragraphs, longest sentence ${chapter.longestSentenceWords} words.`),
    ...report.sourceUsage.map((chapter) => `- Chapter ${chapter.chapterNo} source facts in narration: ${chapter.used} / ${chapter.facts} (${chapter.share * 100}%).`),
    '',
    'Analyzer metrics are screening heuristics and need human review.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}
