import { z } from 'zod';

export const QA_ISSUE_TYPES = [
  'REPETITION', 'CONTRADICTION', 'DEAD_CHAPTER', 'POSSIBLE_FILLER', 'WEAK_HOOK', 'FLAT_PACING',
  'PREMATURE_REVEAL', 'UNRESOLVED_LOOP', 'WEAK_PAYOFF', 'AWKWARD_TRANSITION', 'TONE_DRIFT', 'CREDIBILITY_RISK',
] as const;
export const QA_SEVERITIES = ['low', 'medium', 'high'] as const;
export const QA_SUGGESTED_ACTIONS = ['REMOVE_DUPLICATION', 'REGENERATE', 'SHORTEN', 'MOVE_REVEAL', 'REVIEW_FACT'] as const;

export const QAIssueSchema = z.object({
  chapter: z.number().int().positive(),
  type: z.enum(QA_ISSUE_TYPES),
  severity: z.enum(QA_SEVERITIES),
  reason: z.string().min(1),
  suggestedAction: z.enum(QA_SUGGESTED_ACTIONS),
}).strict();

export const QAResultSchema = z.object({ issues: z.array(QAIssueSchema) }).strict();
export type QAIssue = z.infer<typeof QAIssueSchema>;
export type QAResult = z.infer<typeof QAResultSchema>;
