import type { YoutubeIdeaDropped, YoutubeIdeaV2 } from '../../../contracts/youtube-ideas';
import { auditYoutubeIdeaClaimCoverage, youtubeIdeaCenturyBucket } from './idea-quality';
import type { YoutubeIdeaPipelineResult } from './idea-engine';

export const YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS = 20;

export type YoutubeIdeaRepairCalls = { seeds: number; select: number; expand: number };
export type YoutubeIdeaEvalDurations = { seedsMs: number; selectMs: number; expandMs: number; totalMs: number };

export function createYoutubeIdeaEvalCallBudget(initialUsed = 0, limit = YOUTUBE_IDEA_EVAL_MAX_CLI_CALLS) {
  if (!Number.isInteger(initialUsed) || initialUsed < 0 || !Number.isInteger(limit) || limit < 1 || initialUsed > limit) {
    throw new Error('Invalid YouTube idea eval CLI call budget.');
  }
  let used = initialUsed;
  return {
    get used() { return used; },
    claim(): boolean {
      if (used >= limit) return false;
      used += 1;
      return true;
    },
  };
}

export function computeYoutubeIdeaEvalMetrics(input: {
  ideas: YoutubeIdeaV2[];
  dropped: YoutubeIdeaDropped[];
  packetJson: string;
  repairCalls: YoutubeIdeaRepairCalls;
  durations: YoutubeIdeaEvalDurations;
  diagnostics?: YoutubeIdeaPipelineResult['diagnostics'];
}) {
  const blindSpotAtLeastPartial = input.ideas.filter((idea) => idea.motif.blindSpot.evidence !== 'thin').length;
  const archetypeCounts = input.ideas.reduce<Record<string, number>>((counts, idea) => {
    counts[idea.hunterArchetype] = (counts[idea.hunterArchetype] ?? 0) + 1;
    return counts;
  }, {});
  const centuries = new Set(input.ideas.map((idea) => youtubeIdeaCenturyBucket(idea.period)).filter((value): value is number => value !== null));
  const claims = input.ideas.flatMap((idea) => idea.claims);
  const claimAudits = input.ideas.map((idea) => auditYoutubeIdeaClaimCoverage(idea, input.packetJson));
  const droppedReasonCounts = input.dropped.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
  return {
    kept: input.ideas.length,
    dropped: input.dropped.length,
    droppedReasonCounts,
    blindSpotAtLeastPartial,
    blindSpotShare: input.ideas.length ? blindSpotAtLeastPartial / input.ideas.length : 0,
    distinctHunterArchetypes: Object.keys(archetypeCounts).length,
    archetypeCounts,
    distinctCenturies: centuries.size,
    famousnessFamousCount: input.ideas.filter((idea) => idea.famousnessGuess === 'famous').length,
    claims: claims.length,
    lowConfidenceClaims: claims.filter((claim) => claim.confidence === 'low').length,
    lowConfidenceShare: claims.length ? claims.filter((claim) => claim.confidence === 'low').length / claims.length : 0,
    unbackedNumbers: [...new Set(claimAudits.flatMap((audit) => audit.unbackedNumbers))],
    unbackedNames: [...new Set(claimAudits.flatMap((audit) => audit.unbackedNames))],
    unsupportedCausalStatements: claimAudits.flatMap((audit) => audit.unsupportedCausalStatements),
    repairCalls: { ...input.repairCalls },
    durations: { ...input.durations },
    funnel: input.diagnostics ? {
      seeds: input.diagnostics.seedCount,
      shortlisted: input.diagnostics.shortlistedCount,
      expanded: input.diagnostics.expandedCount,
      valid: input.diagnostics.validCount,
    } : null,
    expansionBatches: input.diagnostics?.expansionBatches ?? [],
    repairRescues: input.diagnostics?.repairRescues ?? 0,
    budgetStopped: input.diagnostics?.budgetStopped ?? false,
    titles: input.ideas.map(({ title, trapSketch }) => ({ title, trapSketch })),
  };
}
