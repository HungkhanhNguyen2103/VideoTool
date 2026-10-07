export type FreesoundSoundCandidate = {
  id: number;
  name: string;
  tags: string[];
  duration: number;
  avg_rating: number;
  num_ratings: number;
  previews: Record<string, string | undefined>;
};

const VOICE_LIKE = /\b(?:speech|voice|vocal|shout\w*|scream\w*|yell\w*|crowd|chant\w*|sing\w*|talk\w*|narrat\w*|human|war[- ]?cry)\b/i;
const WORD = /[\p{L}\p{N}]+/gu;

function scoreCandidate(candidate: FreesoundSoundCandidate, queryWords: Set<string>): number | null {
  if (VOICE_LIKE.test(`${candidate.name} ${candidate.tags.join(' ')}`) || candidate.duration < 1) return null;

  const candidateWords = new Set(`${candidate.name} ${candidate.tags.join(' ')}`.toLowerCase().match(WORD) ?? []);
  const overlap = [...queryWords].filter((word) => candidateWords.has(word)).length;
  const durationScore = candidate.duration >= 2 && candidate.duration <= 8 ? 2 : 0;
  const ratingScore = Math.max(0, Math.min(5, candidate.avg_rating)) * 0.5;
  const ratedScore = candidate.num_ratings >= 3 ? 1 : 0;
  return overlap * 4 + durationScore + ratingScore + ratedScore;
}

/** Selects a locally relevant, non-voice sound; original result order breaks ties. */
export function chooseBestSfxCandidate(
  candidates: readonly FreesoundSoundCandidate[],
  query: string,
): FreesoundSoundCandidate | null {
  return rankSfxCandidates(candidates, query)[0] ?? null;
}

export function rankSfxCandidates(
  candidates: readonly FreesoundSoundCandidate[],
  query: string,
): FreesoundSoundCandidate[] {
  const queryWords = new Set(query.toLowerCase().match(WORD) ?? []);
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate, queryWords) }))
    .filter((row): row is { candidate: FreesoundSoundCandidate; index: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.candidate);
}
