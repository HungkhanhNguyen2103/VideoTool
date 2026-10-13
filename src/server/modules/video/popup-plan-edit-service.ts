import { z } from 'zod';
import { PopupKindSchema, type PopupPlan, type PopupPlanDrop, type PopupPlanPopup } from '../../../contracts/popup-analysis';
import { hashNarration } from '../../../contracts/name-keywords';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { activeScenes } from '../../../contracts/scene-active';
import { AppError } from '../../shared/errors';
import { assertSceneActive, getProject, setProjectScenePopupPlans, type ProjectScenePopupPlanUpdate } from '../project';
import { applyPopupSafetyNet, type PopupSafetyCandidate } from './popup-safety-net';
import { normalisePopupAnchor } from './popup-plan';
import { validatePopupCandidate, type PopupCandidateInput } from './popup-validation';
import { windowPopupTiming } from './popup-window';

const PopupCandidateSchema = z.object({
  kind: PopupKindSchema,
  anchor: z.string().trim().min(1),
  display: z.string().trim().min(1),
  importance: z.number().int().min(1).max(5),
  reason: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  evidence: z.string().trim().min(1).optional(),
}).strict();

export const PopupPlanFlagsSchema = z.object({
  anchor: z.string().trim().min(1),
  pinned: z.boolean().optional(),
  suppressed: z.boolean().optional(),
}).strict().refine((value) => value.pinned !== undefined || value.suppressed !== undefined, { message: 'Cần chọn trạng thái ghim hoặc tắt popup.' });
export type PopupPlanFlagsInput = z.infer<typeof PopupPlanFlagsSchema>;

export const PopupPlanEditSchema = PopupCandidateSchema;
export type PopupPlanEditInput = z.infer<typeof PopupPlanEditSchema>;

export type PopupPlanConflict = {
  sceneId: string;
  sceneNumber: number;
  anchor: string;
  reason: string;
};

export type PopupPlanMutationResult = {
  project: ProjectDetail;
  conflicts: PopupPlanConflict[];
};

type PopupPlanEntry = {
  scene: Scene;
  sceneStartSec: number;
  popup: PopupPlanPopup;
};

type PopupPlanMutationDependencies = {
  getProject?: typeof getProject;
  setProjectScenePopupPlans?: typeof setProjectScenePopupPlans;
};

function freshPlan(scene: Scene): PopupPlan | null {
  return scene.popupPlan && scene.audioFileId && scene.wordTimings?.audioFileId === scene.audioFileId && scene.popupPlan.audioFileId === scene.audioFileId && scene.popupPlan.narrationHash === hashNarration(scene.narration)
    ? scene.popupPlan
    : null;
}

function planEntries(project: ProjectDetail): PopupPlanEntry[] {
  const entries: PopupPlanEntry[] = [];
  let sceneStartSec = 0;
  for (const scene of activeScenes(project.scenes)) {
    const plan = freshPlan(scene);
    if (plan) {
      for (const popup of [...plan.popups, ...plan.dropped]) {
        entries.push({ scene, sceneStartSec, popup });
      }
    }
    sceneStartSec += scene.durationSec;
  }
  return entries;
}

function targetEntry(entries: readonly PopupPlanEntry[], sceneId: string, anchor: string): PopupPlanEntry {
  const target = normalisePopupAnchor(anchor);
  const entry = entries.find((candidate) => candidate.scene.id === sceneId && normalisePopupAnchor(candidate.popup.anchor) === target);
  if (!entry) throw new AppError('Không tìm thấy popup trong kế hoạch hiện tại.', 404, 'POPUP_NOT_FOUND');
  return entry;
}

function assembleUpdatedPlans(project: ProjectDetail, entries: readonly PopupPlanEntry[]): {
  updates: ProjectScenePopupPlanUpdate[];
  conflicts: PopupPlanConflict[];
} {
  const safety = applyPopupSafetyNet(entries.map((entry) => ({ sceneId: entry.scene.id, sceneStartSec: entry.sceneStartSec, popup: entry.popup as PopupSafetyCandidate })));
  const keptByScene = new Map<string, PopupPlanPopup[]>();
  const droppedByScene = new Map<string, PopupPlanDrop[]>();
  for (const entry of safety.kept) keptByScene.set(entry.sceneId, [...(keptByScene.get(entry.sceneId) ?? []), entry.popup]);
  for (const entry of safety.dropped) droppedByScene.set(entry.sceneId, [...(droppedByScene.get(entry.sceneId) ?? []), entry.popup]);
  const updates: ProjectScenePopupPlanUpdate[] = [];
  for (const scene of activeScenes(project.scenes)) {
    const plan = freshPlan(scene);
    if (!plan || !scene.audioFileId) continue;
    updates.push({
      sceneId: scene.id,
      expectedNarration: scene.narration,
      expectedAudioFileId: scene.audioFileId,
      popupPlan: {
        ...plan,
        generatedAt: plan.generatedAt,
        popups: keptByScene.get(scene.id) ?? [],
        dropped: droppedByScene.get(scene.id) ?? [],
      },
    });
  }
  const conflicts = safety.dropped
    .filter((entry) => entry.popup.dropReason === 'gần popup khác')
    .map((entry) => ({
      sceneId: entry.sceneId,
      sceneNumber: project.scenes.findIndex((scene) => scene.id === entry.sceneId) + 1,
      anchor: entry.popup.anchor,
      reason: entry.popup.dropReason ?? 'gần popup khác',
    }));
  return { updates, conflicts };
}

async function mutateProjectPopupPlan(
  projectId: string,
  mutate: (entries: readonly PopupPlanEntry[]) => PopupPlanEntry[],
  dependencies: PopupPlanMutationDependencies,
  initialProject?: ProjectDetail,
): Promise<PopupPlanMutationResult> {
  const project = initialProject ?? await (dependencies.getProject ?? getProject)(projectId);
  const entries = planEntries(project);
  const nextEntries = mutate(entries);
  const assembled = assembleUpdatedPlans(project, nextEntries);
  const previousConflictKeys = new Set(entries
    .filter((entry) => entry.popup.status === 'dropped' && entry.popup.dropReason === 'gần popup khác')
    .map((entry) => `${entry.scene.id}:${normalisePopupAnchor(entry.popup.anchor)}`));
  const newConflicts = assembled.conflicts.filter((conflict) => !previousConflictKeys.has(`${conflict.sceneId}:${normalisePopupAnchor(conflict.anchor)}`));
  const applied = await (dependencies.setProjectScenePopupPlans ?? setProjectScenePopupPlans)(projectId, assembled.updates);
  if (applied !== assembled.updates.length) throw new AppError('Popup đã thay đổi trong lúc cập nhật; vui lòng tải lại rồi thử lại.', 409, 'POPUP_PLAN_STALE');
  return { project: await (dependencies.getProject ?? getProject)(projectId), conflicts: newConflicts };
}

export async function updateProjectPopupPlanFlags(
  projectId: string,
  sceneId: string,
  input: PopupPlanFlagsInput,
  dependencies: PopupPlanMutationDependencies = {},
): Promise<PopupPlanMutationResult> {
  const project = await (dependencies.getProject ?? getProject)(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (scene) assertSceneActive(scene);
  const entries = planEntries(project);
  const target = targetEntry(entries, sceneId, input.anchor);
  const targetAnchor = normalisePopupAnchor(target.popup.anchor);
  return mutateProjectPopupPlan(projectId, (currentEntries) => currentEntries.map((entry) => entry.scene.id === sceneId && normalisePopupAnchor(entry.popup.anchor) === targetAnchor
    ? { ...entry, popup: { ...entry.popup, pinned: input.pinned ?? entry.popup.pinned, suppressed: input.suppressed ?? entry.popup.suppressed } }
    : entry), dependencies, project);
}

export async function editProjectPopupPlan(
  projectId: string,
  sceneId: string,
  input: PopupPlanEditInput,
  dependencies: PopupPlanMutationDependencies = {},
): Promise<PopupPlanMutationResult> {
  const project = await (dependencies.getProject ?? getProject)(projectId);
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (scene) assertSceneActive(scene);
  const entries = planEntries(project);
  const target = targetEntry(entries, sceneId, input.anchor);
  const words = target.scene.wordTimings?.words ?? [];
  const validation = validatePopupCandidate(target.scene.narration, words, input as PopupCandidateInput, { brief: project.brief, referencesText: project.referencesText });
  if (!validation.accepted) throw new AppError(`Không thể sửa popup: ${validation.reason}.`, 422, 'POPUP_PLAN_EDIT_INVALID');
  const window = windowPopupTiming({ kind: input.kind, startSec: validation.startSec, endSec: validation.endSec }, words);
  if (!window.accepted) throw new AppError(`Không thể sửa popup: ${window.reason}.`, 422, 'POPUP_PLAN_EDIT_INVALID');
  const replacement: PopupPlanPopup = {
    ...input,
    startSec: window.startSec,
    endSec: window.endSec,
    status: 'kept',
    dropReason: null,
    pinned: target.popup.pinned,
    suppressed: target.popup.suppressed,
  };
  const targetAnchor = normalisePopupAnchor(target.popup.anchor);
  return mutateProjectPopupPlan(projectId, (currentEntries) => currentEntries.map((entry) => entry.scene.id === sceneId && normalisePopupAnchor(entry.popup.anchor) === targetAnchor ? { ...entry, popup: replacement } : entry), dependencies, project);
}
