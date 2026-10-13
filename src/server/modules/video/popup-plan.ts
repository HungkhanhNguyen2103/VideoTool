import type { PopupBackend, PopupDensity, PopupPlan, PopupPlanDrop, PopupPlanPopup } from '../../../contracts/popup-analysis';
import type { PopupAiCandidate, PopupAiOutput } from './ai/output-schema';
import { hashNarration } from '../../../contracts/name-keywords';
import { nameKeywordDedupeKey } from './keywords';
import { applyPopupSafetyNet, type PopupSafetyCandidate } from './popup-safety-net';
import { validatePopupCandidate } from './popup-validation';
import { windowPopupTiming } from './popup-window';
import type { TimedWord } from './keywords';

export type PopupAssemblyScene = {
  id: string;
  scene: number;
  sceneStartSec: number;
  narration: string;
  audioFileId: string;
  words: readonly TimedWord[];
};

export type PopupPlanAssemblyInput = {
  scenes: readonly PopupAssemblyScene[];
  aiOutput: PopupAiOutput;
  previousPlans?: ReadonlyMap<string, PopupPlan | null> | Readonly<Record<string, PopupPlan | null | undefined>>;
  brief: string;
  referencesText: string;
  density: PopupDensity;
  backend: PopupBackend;
  provider: 'deepseek' | 'claude';
  model: string;
  now?: Date;
};

export type PopupPlanAssemblySummary = {
  scenesNeeded: number;
  scenesNotNeeded: number;
  keptPopups: number;
  droppedPopups: number;
  rejectedByValidation: number;
};

export type PopupPlanAssemblyResult = {
  plans: Array<{ sceneId: string; plan: PopupPlan }>;
  summary: PopupPlanAssemblySummary;
};

function normaliseAnchor(value: string): string {
  return nameKeywordDedupeKey(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function previousPlanFor(input: PopupPlanAssemblyInput, sceneId: string): PopupPlan | null {
  if (!input.previousPlans) return null;
  if (typeof (input.previousPlans as ReadonlyMap<string, PopupPlan | null>).get === 'function') return (input.previousPlans as ReadonlyMap<string, PopupPlan | null>).get(sceneId) ?? null;
  return (input.previousPlans as Readonly<Record<string, PopupPlan | null | undefined>>)[sceneId] ?? null;
}

function previousPopup(plan: PopupPlan | null, anchor: string): PopupPlanPopup | null {
  if (!plan) return null;
  const target = normaliseAnchor(anchor);
  return [...plan.popups, ...plan.dropped].find((popup) => normaliseAnchor(popup.anchor) === target) ?? null;
}

function toCandidate(candidate: PopupAiCandidate): Omit<PopupSafetyCandidate, 'startSec' | 'endSec'> {
  return {
    kind: candidate.kind,
    anchor: candidate.anchor,
    display: candidate.display,
    importance: candidate.importance,
    reason: candidate.reason,
    ...(candidate.role ? { role: candidate.role } : {}),
    ...(candidate.evidence ? { evidence: candidate.evidence } : {}),
    pinned: false,
    suppressed: false,
  };
}

function makePlan(
  scene: PopupAssemblyScene,
  verdict: PopupAiOutput['scenes'][number] | undefined,
  input: PopupPlanAssemblyInput,
  popups: PopupPlanPopup[],
  dropped: PopupPlanDrop[],
): PopupPlan {
  return {
    narrationHash: hashNarration(scene.narration),
    audioFileId: scene.audioFileId,
    provider: input.provider,
    model: input.model,
    backend: input.backend,
    density: input.density,
    generatedAt: (input.now ?? new Date()).toISOString(),
    needed: verdict?.needed ?? false,
    reason: verdict?.reason ?? 'Không có verdict hợp lệ từ AI nên không hiển thị popup.',
    popups,
    dropped,
  };
}

/** Validate, window, merge, and safety-filter one project-wide AI result. */
export function assemblePopupPlans(input: PopupPlanAssemblyInput): PopupPlanAssemblyResult {
  const verdicts = new Map(input.aiOutput.scenes.map((verdict) => [verdict.scene, verdict]));
  const generatedEntries: Array<{ sceneId: string; sceneStartSec: number; popup: PopupSafetyCandidate }> = [];
  const verdictByScene = new Map<string, PopupAiOutput['scenes'][number] | undefined>();
  const validationDropsByScene = new Map<string, PopupPlanDrop[]>();
  let rejectedByValidation = 0;
  let scenesNeeded = 0;
  let scenesNotNeeded = 0;

  for (const scene of input.scenes) {
    const verdict = verdicts.get(scene.scene);
    verdictByScene.set(scene.id, verdict);
    if (verdict?.needed) scenesNeeded += 1;
    else scenesNotNeeded += 1;
    if (!verdict?.needed) continue;
    for (const aiCandidate of verdict.popups) {
      const candidate = toCandidate(aiCandidate);
      const validation = validatePopupCandidate(scene.narration, scene.words, candidate, { brief: input.brief, referencesText: input.referencesText });
      if (!validation.accepted) {
        rejectedByValidation += 1;
        continue;
      }
      const prior = previousPopup(previousPlanFor(input, scene.id), candidate.anchor);
      const window = windowPopupTiming({ kind: candidate.kind, startSec: validation.startSec, endSec: validation.endSec }, scene.words);
      if (!window.accepted) {
        rejectedByValidation += 1;
        const dropped: PopupPlanDrop = {
          ...candidate,
          startSec: validation.startSec,
          endSec: validation.endSec,
          status: 'dropped',
          dropReason: window.reason,
          pinned: prior?.pinned ?? false,
          suppressed: prior?.suppressed ?? false,
        };
        validationDropsByScene.set(scene.id, [...(validationDropsByScene.get(scene.id) ?? []), dropped]);
        continue;
      }
      generatedEntries.push({
        sceneId: scene.id,
        sceneStartSec: scene.sceneStartSec,
        popup: {
          ...candidate,
          startSec: window.startSec,
          endSec: window.endSec,
          status: 'kept',
          dropReason: null,
          pinned: prior?.pinned ?? false,
          suppressed: prior?.suppressed ?? false,
        },
      });
    }
  }

  const safety = applyPopupSafetyNet(generatedEntries);
  const keptByScene = new Map<string, PopupPlanPopup[]>();
  const droppedByScene = new Map<string, PopupPlanDrop[]>();
  for (const entry of safety.kept) keptByScene.set(entry.sceneId, [...(keptByScene.get(entry.sceneId) ?? []), entry.popup]);
  for (const [sceneId, drops] of validationDropsByScene) droppedByScene.set(sceneId, [...drops]);
  for (const entry of safety.dropped) droppedByScene.set(entry.sceneId, [...(droppedByScene.get(entry.sceneId) ?? []), entry.popup]);

  const plans = input.scenes.map((scene) => ({
    sceneId: scene.id,
    plan: makePlan(scene, verdictByScene.get(scene.id), input, keptByScene.get(scene.id) ?? [], droppedByScene.get(scene.id) ?? []),
  }));
  return {
    plans,
    summary: {
      scenesNeeded,
      scenesNotNeeded,
      keptPopups: safety.kept.length,
      droppedPopups: safety.dropped.length,
      rejectedByValidation,
    },
  };
}
