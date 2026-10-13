import type { PopupPlanPopup, PopupPlanDrop } from '../../../contracts/popup-analysis';
import { nameKeywordDedupeKey } from './keywords';

export const MAX_POPUPS_PER_SCENE = 2;
export const MIN_POPUP_START_SPACING_SEC = 3;

export type PopupSafetyCandidate = Omit<PopupPlanPopup, 'status' | 'dropReason' | 'startSec' | 'endSec' | 'pinned' | 'suppressed'> & {
  startSec: number;
  endSec: number;
  status?: 'kept' | 'dropped';
  dropReason?: string | null;
  pinned?: boolean;
  suppressed?: boolean;
};

export type PopupSafetyEntry = { sceneId: string; sceneStartSec: number; popup: PopupPlanPopup };
export type PopupSafetyDrop = { sceneId: string; sceneStartSec: number; popup: PopupPlanDrop };

function absoluteStart(entry: PopupSafetyEntry): number {
  return entry.sceneStartSec + entry.popup.startSec;
}

function wins(left: PopupSafetyEntry, right: PopupSafetyEntry): boolean {
  if (left.popup.pinned !== right.popup.pinned) return left.popup.pinned;
  if (left.popup.importance !== right.popup.importance) return left.popup.importance > right.popup.importance;
  return absoluteStart(left) < absoluteStart(right);
}

function conflicts(left: PopupSafetyEntry, right: PopupSafetyEntry): boolean {
  const leftStart = absoluteStart(left);
  const rightStart = absoluteStart(right);
  const leftEnd = left.sceneStartSec + left.popup.endSec;
  const rightEnd = right.sceneStartSec + right.popup.endSec;
  return leftStart < rightEnd && rightStart < leftEnd || Math.abs(leftStart - rightStart) < MIN_POPUP_START_SPACING_SEC;
}

function nameKey(popup: PopupPlanPopup): string | null {
  if (!['person', 'place', 'event'].includes(popup.kind)) return null;
  const normalized = nameKeywordDedupeKey(popup.display);
  return normalized || null;
}

function toDrop(entry: PopupSafetyEntry, reason: string): PopupSafetyDrop {
  return { ...entry, popup: { ...entry.popup, status: 'dropped', dropReason: reason } };
}

/** Apply only the named A4 constraints; the AI verdict remains authoritative otherwise. */
export function applyPopupSafetyNet(entries: ReadonlyArray<{ sceneId: string; sceneStartSec: number; popup: PopupSafetyCandidate }>): { kept: PopupSafetyEntry[]; dropped: PopupSafetyDrop[] } {
  const kept: PopupSafetyEntry[] = [];
  const dropped: PopupSafetyDrop[] = [];
  const firstNameScene = new Map<string, string>();
  const ordered = entries.map((entry) => ({ ...entry, popup: { ...entry.popup, status: 'kept' as const, dropReason: null } })).sort((left, right) => left.sceneStartSec + left.popup.startSec - right.sceneStartSec - right.popup.startSec);
  for (const candidate of ordered) {
    const entry = candidate as PopupSafetyEntry;
    if (entry.popup.suppressed) {
      dropped.push(toDrop(entry, 'đã tắt'));
      continue;
    }
    const key = nameKey(entry.popup);
    if (key && firstNameScene.has(key) && firstNameScene.get(key) !== entry.sceneId) {
      dropped.push(toDrop(entry, 'đã hiện ở cảnh trước'));
      continue;
    }
    if (key && !firstNameScene.has(key)) firstNameScene.set(key, entry.sceneId);
    const conflicting = kept.filter((prior) => conflicts(prior, entry));
    const sceneEntries = kept.filter((prior) => prior.sceneId === entry.sceneId);
    const capacityConflict = sceneEntries.length >= MAX_POPUPS_PER_SCENE;
    const blockers = [...new Set([...conflicting, ...(capacityConflict ? [sceneEntries[sceneEntries.length - 1]!] : [])])];
    const losers = blockers.filter((prior) => !wins(entry, prior));
    if (losers.length > 0) {
      dropped.push(toDrop(entry, conflicting.length > 0 ? 'gần popup khác' : 'quá nhiều popup trong scene'));
      continue;
    }
    for (const loser of blockers) {
      const index = kept.indexOf(loser);
      if (index >= 0) kept.splice(index, 1);
      dropped.push(toDrop(loser, conflicting.includes(loser) ? 'gần popup khác' : 'quá nhiều popup trong scene'));
    }
    kept.push(entry);
  }
  return { kept: kept.sort((left, right) => absoluteStart(left) - absoluteStart(right)), dropped };
}
