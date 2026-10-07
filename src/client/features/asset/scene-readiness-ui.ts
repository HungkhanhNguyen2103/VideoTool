import type { SceneReadinessStatus } from '../../../contracts/scene-readiness';

export type ReadinessBadgeTone = 'red' | 'amber' | 'muted';
export type ReadinessBadge = { label: string; tone: ReadinessBadgeTone };

const BADGES: Partial<Record<SceneReadinessStatus, ReadinessBadge>> = {
  'missing-asset': { label: 'Thiếu asset', tone: 'red' },
  'missing-clip': { label: 'Thiếu clip', tone: 'red' },
  'keyframe-only': { label: 'Chỉ có keyframe', tone: 'amber' },
  'clip-unmeasured': { label: 'Chưa đo clip', tone: 'muted' },
  'clip-cut': { label: 'Clip bị cắt', tone: 'amber' },
  'clip-padded': { label: 'Clip được đệm', tone: 'amber' },
};

export function readinessBadgeForStatus(status: SceneReadinessStatus): ReadinessBadge | null {
  return BADGES[status] ?? null;
}
