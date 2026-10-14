import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { VideoDistributionPreview } from '../../../contracts/asset';
import { hashNarration } from '../../../contracts/name-keywords';
import { SfxVolumeSchema, type Scene, type VisualStyleId } from '../../../contracts/project';
import { isVoiceoverFresh, VoiceSpeedSchema } from '../../../contracts/voiceover';
import { SfxBatchSummarySchema } from '../../../contracts/video';
import { analyzeScene } from '../../../contracts/scene-readiness';
import { activeScenes, isSceneActive } from '../../../contracts/scene-active';
import { SceneTailSecSchema, formatDurationSeconds, hasUnappliedSceneTail } from '../../../contracts/scene-duration';
import { isRenderStale } from '../../../contracts/render-freshness';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { toast } from '../../shared/ui/toast-store';
import { useJobProgress } from '../../shared/hooks/use-job-progress';
import { BlockingProgressDialog } from '../../shared/ui/BlockingProgressDialog';
import { AiModelSelect } from '../../shared/ai/AiModelSelect';
import { isStudioLocked, taskFromBusyKey, type BlockingTask } from '../../shared/ui/blocking-progress';
import { cancelJob } from '../../shared/job-api';
import { ApiError } from '../../shared/api-client';
import * as api from './api';
import { computePipelineProgress } from './pipeline-progress';
import { summarizeRenderReadiness } from './render-readiness';
import { readinessBadgeForStatus } from './scene-readiness-ui';
import { ProjectLogoControl } from './ProjectLogoControl';
import { ScenePreviewSection, type ScenePreviewState } from './ScenePreviewSection';
import { createScenePreviewFingerprint } from './scene-preview';
import { nameKeywordPopupLine } from './name-keyword-ui';
import { VoiceoverListenPanel } from './VoiceoverListenPanel';
import { PopupAnalysisCard, type PopupAnalysisSummary } from './components/PopupAnalysisCard';
import { SceneActiveToggle } from './SceneActiveToggle';
import { useSetSceneActive } from './hooks';
import { formatBatchSceneCount, formatSceneActivityHeader, formatSkippedInactiveToast, isSceneToggleDisabled, summarizeSceneActivity } from './scene-activity-ui';
import styles from './StudioPage.module.css';

const statusTone = { draft: 'muted', script: 'indigo', assets: 'green', rendered: 'green' } as const;
const statusLabel = { draft: 'Bản nháp', script: 'Kịch bản', assets: 'Đang làm asset', rendered: 'Đã render' } as const;
const INACTIVE_SCENE_ACTION_TITLE = 'Scene đang tắt — bật lại để dùng chức năng này';

export function StudioPage() {
  const { projectId = '' } = useParams();
  const [busy, setBusyState] = useState<string | null>(null);
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [editingNarrationScene, setEditingNarrationScene] = useState<string | null>(null);
  const [draftNarration, setDraftNarration] = useState('');
  const [editingMotionScene, setEditingMotionScene] = useState<string | null>(null);
  const [draftMotionPrompt, setDraftMotionPrompt] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [bgmMood, setBgmMood] = useState('');
  const [sceneTailDraft, setSceneTailDraft] = useState('0.2');
  const [sfxVolumeDraft, setSfxVolumeDraft] = useState('0.5');
  const [voiceSpeedDraft, setVoiceSpeedDraft] = useState('1');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobTask, setJobTask] = useState<BlockingTask | null>(null);
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [jobLastEventAt, setJobLastEventAt] = useState<number | null>(null);
  const [jobReconnectKey, setJobReconnectKey] = useState(0);
  const [jobLocallyUnlocked, setJobLocallyUnlocked] = useState(false);
  const [voiceoverJobId, setVoiceoverJobId] = useState<string | null>(null);
  const [sfxJobId, setSfxJobId] = useState<string | null>(null);
  const [popupAnalysisSummary, setPopupAnalysisSummary] = useState<PopupAnalysisSummary | null>(null);
  const [lastSfxBatchSummary, setLastSfxBatchSummary] = useState<{ failed: number; rateLimitedStop: boolean; skippedInactive: number } | null>(null);
  const [voiceoverResetSceneIds, setVoiceoverResetSceneIds] = useState<Set<string>>(new Set());
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);
  const [scenePreviews, setScenePreviews] = useState<Record<string, ScenePreviewState>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string | null>>({});
  const [videoDistributionPercent, setVideoDistributionPercent] = useState(20);
  const [videoDistributionTarget, setVideoDistributionTarget] = useState(20);
  const [videoDistributionPreview, setVideoDistributionPreview] = useState<VideoDistributionPreview | null>(null);
  const [renderConfirmationDraft, setRenderConfirmationDraft] = useState<boolean | null>(null);
  const [listenMode, setListenMode] = useState(false);
  const [voiceoverReloadVersions, setVoiceoverReloadVersions] = useState<Record<string, number>>({});
  const [voiceoverConfirmSceneId, setVoiceoverConfirmSceneId] = useState<string | null>(null);
  const scenePreviewsRef = useRef<Record<string, ScenePreviewState>>({});
  const refreshedJobRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const renderConfirmDialogRef = useRef<HTMLDialogElement>(null);
  const voiceoverConfirmDialogRef = useRef<HTMLDialogElement>(null);
  const projectQuery = useQuery({ queryKey: ['projects', 'detail', projectId], queryFn: () => api.getProject(projectId), enabled: Boolean(projectId) });
  const filesQuery = useQuery({ queryKey: ['project-files', projectId], queryFn: () => api.listProjectFiles(projectId), enabled: Boolean(projectId) });
  const project = projectQuery.data;
  const cliStatusQuery = useQuery({
    queryKey: ['script', 'claude-cli-status'],
    queryFn: api.getClaudeCliStatus,
    enabled: Boolean(project),
    staleTime: 15_000,
    retry: false,
  });
  const scenes = project?.scenes ?? [];
  const files = filesQuery.data ?? [];
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const voiceoverAudioUrls = useMemo(() => Object.fromEntries(scenes.flatMap((scene) => {
    const file = scene.audioFileId ? filesById.get(scene.audioFileId) : undefined;
    return file?.mimeType.startsWith('audio/') ? [[scene.id, api.fileUrlForSummary(file)] as const] : [];
  })), [filesById, scenes]);
  const activeSceneList = useMemo(() => activeScenes(scenes), [scenes]);
  const sceneActivity = summarizeSceneActivity(scenes);
  const filled = activeSceneList.filter((scene) => scene.assetFileId !== null).length;
  const missingScenes = project ? api.missingSceneNumbers(project) : [];
  const readinessBySceneId = useMemo(() => new Map(scenes.map((scene) => [scene.id, analyzeScene(scene)])), [scenes]);
  const renderReadiness = useMemo(() => summarizeRenderReadiness(scenes), [scenes]);
  const popupEligibleScenes = activeSceneList.filter((scene) => scene.audioFileId && scene.wordTimings?.audioFileId === scene.audioFileId && scene.wordTimings.words.length > 0);
  const popupUnreadyScenes = popupEligibleScenes.filter((scene) => !(scene.popupPlan && scene.popupPlan.audioFileId === scene.audioFileId && scene.popupPlan.narrationHash === hashNarration(scene.narration)));
  const pipelineProgress = useMemo(() => project ? computePipelineProgress(project) : null, [project]);
  const hasUnappliedTail = project ? hasUnappliedSceneTail(activeSceneList, project.sceneTailSec) : false;
  const expandedScene = scenes.find((scene) => scene.id === expandedSceneId) ?? null;
  const expandedSceneActive = expandedScene ? isSceneActive(expandedScene) : false;
  const expandedInactiveActionTitle = expandedSceneActive ? undefined : INACTIVE_SCENE_ACTION_TITLE;
  const expandedEditing = expandedScene !== null && editingScene === expandedScene.id;
  const expandedNarrationEditing = expandedScene !== null && editingNarrationScene === expandedScene.id;
  const expandedMotionEditing = expandedScene !== null && editingMotionScene === expandedScene.id;
  const expandedSceneBusy = expandedScene !== null && busy === `scene:${expandedScene.id}`;
  const expandedVoiceoverFile = expandedScene?.audioFileId ? filesById.get(expandedScene.audioFileId) : undefined;
  const expandedSfxFile = expandedScene?.sfxFileId ? filesById.get(expandedScene.sfxFileId) : undefined;
  const expandedReadiness = expandedScene ? readinessBySceneId.get(expandedScene.id) : undefined;
  const expandedSceneNumber = expandedScene ? scenes.findIndex((scene) => scene.id === expandedScene.id) + 1 : 0;
  const expandedAssetFile = expandedScene?.assetFileId ? filesById.get(expandedScene.assetFileId) : undefined;
  const expandedAssetSrc = expandedAssetFile ? api.fileUrlForSummary(expandedAssetFile) : null;
  const expandedAssetType = expandedAssetFile ? api.mediaTypeForMime(expandedAssetFile.mimeType) : null;
  const expandedPopupPlan = expandedScene && expandedScene.audioFileId && expandedScene.wordTimings?.audioFileId === expandedScene.audioFileId
    && expandedScene.popupPlan?.audioFileId === expandedScene.audioFileId && expandedScene.popupPlan.narrationHash === hashNarration(expandedScene.narration)
    ? expandedScene.popupPlan
    : null;
  const expandedNamePopup = expandedPopupPlan?.popups.find((popup) => popup.status === 'kept' && !popup.suppressed && ['person', 'place', 'event'].includes(popup.kind)) ?? null;
  const progress = useJobProgress(jobId, jobReconnectKey);
  const sceneActivationMutation = useSetSceneActive(projectId);
  const busyTask = useMemo(() => taskFromBusyKey(busy, (sceneId) => {
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    return index >= 0 ? `Scene ${String(index + 1).padStart(2, '0')}` : undefined;
  }), [busy, scenes]);
  const activeBlockingTask = jobTask ?? busyTask;
  const activeBlockingStartedAt = jobTask ? jobStartedAt : busyStartedAt;
  const studioLocked = !jobLocallyUnlocked && isStudioLocked(busy, jobId, progress);
  const sceneToggleDisabled = isSceneToggleDisabled({ jobId, progress, busy, mutationPending: sceneActivationMutation.isPending });
  const voiceoverConfirmStartIndex = voiceoverConfirmSceneId ? scenes.findIndex((scene) => scene.id === voiceoverConfirmSceneId) : -1;
  const voiceoverConfirmScenes = voiceoverConfirmStartIndex >= 0 ? scenes.slice(voiceoverConfirmStartIndex) : [];
  const voiceoverConfirmCount = activeScenes(voiceoverConfirmScenes).filter((scene) => scene.narration.trim()).length;
  const voiceoverConfirmBatchText = formatBatchSceneCount(voiceoverConfirmScenes, (scene) => scene.narration.trim().length > 0);
  const voiceoverConfirmStartNumber = voiceoverConfirmStartIndex >= 0 ? voiceoverConfirmStartIndex + 1 : 0;

  useEffect(() => { if (project) setBgmMood(project.bgmMood); }, [project?.id, project?.bgmMood]);
  useEffect(() => { if (project) setSceneTailDraft(String(project.sceneTailSec)); }, [project?.id, project?.sceneTailSec]);
  useEffect(() => { if (project) setSfxVolumeDraft(String(project.sfxVolume)); }, [project?.id, project?.sfxVolume]);
  useEffect(() => { if (project) setVoiceSpeedDraft(String(project.voiceSpeed)); }, [project?.id, project?.voiceSpeed]);
  useEffect(() => () => { Object.values(scenePreviewsRef.current).forEach(({ url }) => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!jobId || !progress || !['done', 'failed', 'cancelled'].includes(progress.status) || refreshedJobRef.current === jobId) return;
    refreshedJobRef.current = jobId;
    if (progress.status === 'done' && jobTask?.kind === 'popup-analysis') {
      const result = progress.result as { scenesApplied?: unknown; scenesExpected?: unknown; skippedInactive?: unknown; summary?: { rejectedCandidates?: unknown } } | null;
      if (typeof result?.scenesApplied === 'number' && typeof result.scenesExpected === 'number' && typeof result.summary?.rejectedCandidates === 'number') {
        setPopupAnalysisSummary({ scenesApplied: result.scenesApplied, scenesExpected: result.scenesExpected, rejectedCandidates: result.summary.rejectedCandidates });
        toast(`Đã áp dụng ${result.scenesApplied}/${result.scenesExpected} scene; từ chối ${result.summary.rejectedCandidates} ứng viên; bỏ qua ${typeof result.skippedInactive === 'number' ? result.skippedInactive : 0} scene đã tắt.`);
      }
      setJobTask(null);
      setJobId(null);
    } else if (progress.status === 'done' && voiceoverJobId === jobId) {
      const summary = api.voiceoverSummary(progress.result);
      if (summary) toast(summary);
      setVoiceoverJobId(null);
      setJobTask(null);
      setJobId(null);
    } else if (progress.status === 'done' && sfxJobId === jobId) {
      const summary = SfxBatchSummarySchema.safeParse(progress.result);
      setLastSfxBatchSummary(summary.success ? { failed: summary.data.failed, rateLimitedStop: summary.data.rateLimitedStop, skippedInactive: summary.data.skippedInactive } : null);
      if (summary.success) toast(`Đã tạo ${summary.data.generated} SFX; bỏ qua ${summary.data.skippedInactive} scene đã tắt.`);
      setSfxJobId(null);
      setJobTask(null);
      setJobId(null);
    } else if (progress.status === 'done') {
      const skippedToast = formatSkippedInactiveToast(progress.result);
      if (skippedToast) toast(skippedToast);
      setJobTask(null);
      setJobId(null);
    } else {
      toast(progress.error ?? (progress.status === 'cancelled' ? 'Đã huỷ tác vụ.' : 'Tác vụ thất bại.'));
    }
    void refresh();
  }, [jobId, progress?.status, progress?.result, voiceoverJobId, sfxJobId, jobTask]);
  useEffect(() => {
    if (progress) setJobLastEventAt(Date.now());
  }, [progress]);
  useEffect(() => {
    if (!jobId || refreshedJobRef.current === jobId) return undefined;
    const interval = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(interval);
  }, [jobId, progress?.status]);
  useEffect(() => {
    const dialog = detailDialogRef.current;
    if (!dialog) return;
    if (expandedSceneId && !dialog.open) dialog.showModal();
    if (!expandedSceneId && dialog.open) dialog.close();
  }, [expandedSceneId]);
  useEffect(() => {
    const dialog = renderConfirmDialogRef.current;
    if (!dialog) return;
    if (renderConfirmationDraft !== null && !dialog.open) dialog.showModal();
    if (renderConfirmationDraft === null && dialog.open) dialog.close();
  }, [renderConfirmationDraft]);
  useEffect(() => {
    const dialog = voiceoverConfirmDialogRef.current;
    if (!dialog) return;
    if (voiceoverConfirmSceneId && !dialog.open) dialog.showModal();
    if (!voiceoverConfirmSceneId && dialog.open) dialog.close();
  }, [voiceoverConfirmSceneId]);

  function setBusy(value: string | null): void {
    setBusyState(value);
    if (value === null) setBusyStartedAt(null);
    else setBusyStartedAt((current) => current ?? Date.now());
  }

  function startJob(task: BlockingTask, id: string): void {
    setJobTask(task);
    setJobStartedAt(Date.now());
    setJobLastEventAt(Date.now());
    setJobLocallyUnlocked(false);
    setJobId(id);
  }

  async function cancelActiveJob(): Promise<void> {
    if (!jobId) return;
    try {
      await cancelJob(jobId);
      toast('Đã yêu cầu huỷ tác vụ.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể huỷ tác vụ.');
    }
  }

  async function reloadActiveJob(): Promise<void> {
    setJobLastEventAt(Date.now());
    setJobReconnectKey((current) => current + 1);
    await refresh();
  }

  function closeBlockingJob(): void {
    setJobTask(null);
    setJobId(null);
    setVoiceoverJobId(null);
    setJobLocallyUnlocked(false);
  }

  async function refresh() {
    await Promise.all([projectQuery.refetch(), filesQuery.refetch()]);
  }

  function toggleSceneActive(scene: Scene, active: boolean): void {
    if (!project || sceneToggleDisabled || isSceneActive(scene) === active) return;
    sceneActivationMutation.mutate({ sceneId: scene.id, active, expectedVersion: project.version }, {
      onSuccess: () => toast(active ? 'Đã bật scene.' : 'Đã tắt scene.'),
    });
  }

  async function analyzeProjectPopups(options: Parameters<typeof api.analyzeProjectPopups>[1]): Promise<void> {
    try {
      setBusy('popup-analysis');
      setPopupAnalysisSummary(null);
      const result = await api.analyzeProjectPopups(projectId, options);
      startJob({ kind: 'popup-analysis' }, result.jobId);
      toast('Đã xếp hàng phân tích popup.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể phân tích popup.'); }
    finally { setBusy(null); }
  }

  async function changePopupDensity(density: Parameters<typeof api.setPopupDensity>[1]): Promise<void> {
    if (density === project?.popupDensity) return;
    try { setBusy('popup-density'); await api.setPopupDensity(projectId, density); await refresh(); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật mật độ popup.'); }
    finally { setBusy(null); }
  }

  async function togglePopupFlags(sceneId: string, anchor: string, flags: { pinned?: boolean; suppressed?: boolean }): Promise<void> {
    try {
      setBusy('popup-plan');
      const result = await api.setPopupPlanFlags(projectId, sceneId, { anchor, ...flags });
      await refresh();
      if (result.conflicts.length > 0) toast(`Đã cập nhật popup; ${result.conflicts.length} popup xung đột được ghi nhận.`);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật popup.'); }
    finally { setBusy(null); }
  }

  async function editPopup(sceneId: string, popup: Parameters<typeof api.editPopupPlan>[2]): Promise<void> {
    try { setBusy('popup-plan'); await api.editPopupPlan(projectId, sceneId, popup); await refresh(); toast('Đã sửa popup.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể sửa popup.'); }
    finally { setBusy(null); }
  }

  async function copyJson() {
    try {
      setBusy('copy');
      const exported = await api.exportScenesJson(projectId);
      await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
      toast('Đã copy JSON.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể export JSON.'); }
    finally { setBusy(null); }
  }

  async function downloadJson() {
    try {
      setBusy('download');
      const exported = await api.exportScenesJson(projectId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'scenes-export.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tải JSON.'); }
    finally { setBusy(null); }
  }

  async function importZip(file: File) {
    try {
      setBusy('import');
      setUploadProgress(0);
      const result = await api.importAssetsZip(projectId, file, setUploadProgress);
      setSkipped(result.skipped);
      toast(`Đã import ${result.updated} scene${result.updated === 1 ? '' : 's'}.`);
      await refresh();
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể import ZIP.'); }
    finally { setBusy(null); setUploadProgress(null); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  async function patchScene(sceneId: string, body: Parameters<typeof api.patchScene>[2]): Promise<boolean> {
    try { setBusy(`scene:${sceneId}`); await api.patchScene(projectId, sceneId, body); await refresh(); return true; }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật scene.'); return false; }
    finally { setBusy(null); }
  }

  async function setAllAssetType(assetType: 'image' | 'video') {
    try { setBusy('type'); await api.setAllAssetType(projectId, assetType); await refresh(); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi loại asset.'); }
    finally { setBusy(null); }
  }

  async function generateAllVoiceovers(startSceneId?: string) {
    try { setBusy('voiceover-all'); const result = await api.generateAllVoiceovers(projectId, startSceneId ? { startSceneId } : {}); setVoiceoverJobId(result.jobId); startJob({ kind: 'voiceover-all' }, result.jobId); toast('Đã xếp hàng tạo voiceover.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo voiceover.'); }
    finally { setBusy(null); }
  }

  async function continueVoiceoverFromScene(): Promise<void> {
    const startSceneId = voiceoverConfirmSceneId;
    setVoiceoverConfirmSceneId(null);
    if (startSceneId) await generateAllVoiceovers(startSceneId);
  }

  async function fitSceneToClip(scene: Scene) {
    if (!project || scene.videoDurationSec === null) return;
    const sceneNumber = scenes.findIndex((candidate) => candidate.id === scene.id) + 1;
    try {
      setBusy(`fit-to-clip:${scene.id}`);
      const updated = await api.fitSceneToClip(projectId, scene.id, project.version);
      const nextScene = updated.scenes.find((candidate) => candidate.id === scene.id);
      await refresh();
      if (nextScene) toast(`Scene ${sceneNumber}: ${formatDurationSeconds(scene.durationSec)}s -> ${formatDurationSeconds(nextScene.durationSec)}s`);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể kéo dài scene theo clip.'); }
    finally { setBusy(null); }
  }

  async function saveSceneTail(): Promise<void> {
    if (!project) return;
    const parsed = SceneTailSecSchema.safeParse(Number(sceneTailDraft));
    if (!parsed.success) {
      toast('Khoảng nghỉ phải từ 0 đến 2 giây, tối đa 2 chữ số thập phân.');
      setSceneTailDraft(String(project.sceneTailSec));
      return;
    }
    if (parsed.data === project.sceneTailSec) return;
    try {
      setBusy('scene-tail');
      await api.setSceneTail(projectId, parsed.data);
      await refresh();
      toast('Đã cập nhật khoảng nghỉ cuối scene.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật khoảng nghỉ scene.'); }
    finally { setBusy(null); }
  }

  async function saveSfxVolume(): Promise<void> {
    if (!project) return;
    const parsed = SfxVolumeSchema.safeParse(Number(sfxVolumeDraft));
    if (!parsed.success || parsed.data < 0.1) {
      toast('Âm lượng SFX phải từ 0,1 đến 1, tối đa 2 chữ số thập phân.');
      setSfxVolumeDraft(String(project.sfxVolume));
      return;
    }
    if (parsed.data === project.sfxVolume) return;
    try {
      setBusy('sfx-volume');
      await api.setSfxVolume(projectId, parsed.data);
      await refresh();
      toast('Đã cập nhật âm lượng SFX.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật âm lượng SFX.'); }
    finally { setBusy(null); }
  }

  async function saveVoiceSpeed(): Promise<void> {
    if (!project) return;
    const parsed = VoiceSpeedSchema.safeParse(Number(voiceSpeedDraft));
    if (!parsed.success) {
      toast('Tốc độ đọc phải từ 0.8 đến 1.3, theo bước 0.05.');
      setVoiceSpeedDraft(String(project.voiceSpeed));
      return;
    }
    if (parsed.data === project.voiceSpeed) return;
    try {
      setBusy('voice-speed');
      await api.setVoiceSpeed(projectId, parsed.data);
      await refresh();
      toast('Đã cập nhật tốc độ đọc.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật tốc độ đọc.'); }
    finally { setBusy(null); }
  }

  async function recomputeSceneDurations(): Promise<void> {
    try {
      setBusy('recompute-durations');
      const result = await api.recomputeSceneDurations(projectId);
      await refresh();
      const failed = result.failedSceneNumbers.length;
      toast(`Đã cập nhật ${result.updated} scene; bỏ qua ${result.skippedSceneNumbers.length} scene chưa có voiceover, ${result.skippedInactive} scene đã tắt${failed ? `; lỗi đo ${failed} scene` : ''}.`);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tính lại thời lượng theo voiceover.'); }
    finally { setBusy(null); }
  }

  async function previewVideoDistribution() {
    try {
      setBusy('video-distribution-preview');
      const preview = await api.previewVideoDistribution(projectId, videoDistributionPercent);
      setVideoDistributionTarget(videoDistributionPercent);
      setVideoDistributionPreview(preview);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể xem trước phân bổ video.'); }
    finally { setBusy(null); }
  }

  async function applyVideoDistribution() {
    if (!videoDistributionPreview) return;
    try {
      setBusy('video-distribution-apply');
      await api.applyVideoDistribution(projectId, videoDistributionTarget, videoDistributionPreview.projectVersion);
      setVideoDistributionPreview(null);
      await refresh();
      toast('Đã áp dụng phân bổ video.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setVideoDistributionPreview(null);
        toast('Dự án vừa thay đổi, xem trước lại.');
      } else toast(error instanceof Error ? error.message : 'Không thể áp dụng phân bổ video.');
    } finally { setBusy(null); }
  }

  async function alignWordTimings() {
    try { setBusy('align-words'); const result = await api.alignWordTimings(projectId); startJob({ kind: 'align-words' }, result.jobId); toast('Đã xếp hàng căn thời gian từng từ.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể căn thời gian từng từ.'); }
    finally { setBusy(null); }
  }

  async function generateAllSfx() {
    try { setBusy('sfx-all'); const result = await api.generateAllSfx(projectId); setSfxJobId(result.jobId); startJob({ kind: 'sfx-all' }, result.jobId); toast('Đã xếp hàng tạo tất cả SFX.'); }
    catch (error) { setSfxJobId(null); toast(error instanceof Error ? error.message : 'Không thể tạo tất cả SFX.'); }
    finally { setBusy(null); }
  }

  async function regenerateMissingSfx() {
    try { setBusy('sfx-all'); const result = await api.generateAllSfx(projectId, true); setSfxJobId(result.jobId); startJob({ kind: 'sfx-all' }, result.jobId); toast('Đã xếp hàng tạo lại SFX còn thiếu.'); }
    catch (error) { setSfxJobId(null); toast(error instanceof Error ? error.message : 'Không thể tạo lại SFX còn thiếu.'); }
    finally { setBusy(null); }
  }

  async function generateVisualPrompts() {
    try { setBusy('visual-prompts'); const result = await api.generateVisualPrompts(projectId); startJob({ kind: 'visual-prompts' }, result.jobId); toast('Đã xếp hàng tạo visual prompt.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo visual prompt.'); }
    finally { setBusy(null); }
  }

  async function splitScenes() {
    try { setBusy('split-scenes'); const result = await api.splitScenes(projectId); startJob({ kind: 'split-scenes' }, result.jobId); toast('Đã xếp hàng tách nhỏ scene.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tách nhỏ scene.'); }
    finally { setBusy(null); }
  }

  async function regenerateVoiceover(sceneId: string): Promise<boolean> {
    try {
      setBusy(`voice:${sceneId}`);
      await api.regenerateVoiceover(projectId, sceneId);
      await refresh();
      setVoiceoverReloadVersions((current) => ({ ...current, [sceneId]: (current[sceneId] ?? 0) + 1 }));
      setVoiceoverResetSceneIds((current) => { const next = new Set(current); next.delete(sceneId); return next; });
      toast('Đã tạo lại voiceover.');
      return true;
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo lại voiceover.'); return false; }
    finally { setBusy(null); }
  }

  async function generateSfx(sceneId: string) {
    try { setBusy(`sfx:${sceneId}`); await api.generateSceneSfx(projectId, sceneId); await refresh(); toast('Đã tạo SFX.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo SFX.'); }
    finally { setBusy(null); }
  }

  async function generateBgm() {
    try { setBusy('bgm'); await api.generateBgm(projectId, bgmMood); await refresh(); toast('Đã tạo BGM.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo BGM.'); }
    finally { setBusy(null); }
  }

  async function renderProject(draft = false) {
    try { setBusy(draft ? 'render-draft' : 'render'); const result = await api.renderProject(projectId, draft); startJob({ kind: draft ? 'render-draft' : 'render' }, result.jobId); toast(draft ? 'Đã xếp hàng render nháp.' : 'Đã xếp hàng render.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể render.'); }
    finally { setBusy(null); }
  }

  function requestRender(draft = false) {
    if (renderReadiness.confirmations.length > 0) setRenderConfirmationDraft(draft);
    else void renderProject(draft);
  }

  function continueConfirmedRender() {
    if (renderConfirmationDraft === null) return;
    const draft = renderConfirmationDraft;
    setRenderConfirmationDraft(null);
    void renderProject(draft);
  }

  async function setRenderEngine(engine: 'ffmpeg' | 'remotion') {
    if (engine === project?.renderEngine) return;
    try { setBusy('render-engine'); await api.setRenderEngine(projectId, engine); await refresh(); toast(`Đã chọn engine ${engine === 'ffmpeg' ? 'FFmpeg' : 'Remotion'}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi render engine.'); }
    finally { setBusy(null); }
  }

  async function setKeywordPopups(enabled: boolean) {
    if (enabled === project?.keywordPopupsEnabled) return;
    try { setBusy('keyword-popups'); await api.setKeywordPopups(projectId, enabled); await refresh(); toast(`Đã ${enabled ? 'bật' : 'tắt'} chữ pop-up.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi chữ pop-up.'); }
    finally { setBusy(null); }
  }

  async function setTransitionStyle(style: 'crossfade' | 'varied') {
    if (style === project?.transitionStyle) return;
    try { setBusy('transition-style'); await api.setTransitionStyle(projectId, style); await refresh(); toast(`Đã chọn chuyển cảnh ${style === 'varied' ? 'đa dạng' : 'chỉ mờ dần'}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi chuyển cảnh.'); }
    finally { setBusy(null); }
  }

  async function setFilmLook(style: 'auto' | 'always' | 'off') {
    if (style === project?.filmLook) return;
    try { setBusy('film-look'); await api.setFilmLook(projectId, style); await refresh(); toast(`Đã chọn hiệu ứng phim cũ: ${api.FILM_LOOK_OPTIONS.find((option) => option.value === style)?.label ?? style}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi hiệu ứng phim cũ.'); }
    finally { setBusy(null); }
  }

  async function setParallax(style: 'auto' | 'off') {
    if (style === project?.parallax) return;
    try { setBusy('parallax'); await api.setParallax(projectId, style); await refresh(); toast(`Đã chọn hiệu ứng chiều sâu: ${api.PARALLAX_OPTIONS.find((option) => option.value === style)?.label ?? style}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi hiệu ứng chiều sâu.'); }
    finally { setBusy(null); }
  }

  async function generateDepthMaps() {
    try { setBusy('depth-maps'); const result = await api.generateDepthMaps(projectId); startJob({ kind: 'depth-maps' }, result.jobId); toast('Đã xếp hàng tạo depth map.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo depth map.'); }
    finally { setBusy(null); }
  }

  async function setAiProvider(provider: 'deepseek' | 'claude') {
    if (provider === project?.aiProvider) return;
    try { setBusy('ai-provider'); await api.setAiProvider(projectId, provider); await refresh(); toast(`Đã chọn nhà cung cấp AI ${provider === 'deepseek' ? 'DeepSeek' : 'Claude'}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi nhà cung cấp AI.'); }
    finally { setBusy(null); }
  }

  async function setAiModel(model: string) {
    if (model === project?.aiModel || studioLocked || !project) return;
    try { setBusy('ai-model'); await api.setAiProvider(projectId, project.aiProvider, model); await refresh(); toast('Đã chọn model AI.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi model AI.'); }
    finally { setBusy(null); }
  }

  async function setVisualStyle(visualStylePresetId: VisualStyleId) {
    if (visualStylePresetId === project?.visualStylePresetId) return;
    const label = api.VISUAL_STYLE_OPTIONS.find((option) => option.value === visualStylePresetId)?.label ?? visualStylePresetId;
    try { setBusy('visual-style'); await api.setVisualStyle(projectId, visualStylePresetId); await refresh(); toast(`Đã chọn phong cách hình ảnh ${label}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi phong cách hình ảnh.'); }
    finally { setBusy(null); }
  }

  async function previewScene(sceneId: string) {
    const scene = scenes.find((candidate) => candidate.id === sceneId);
    if (!project || !scene) return;
    const fingerprint = createScenePreviewFingerprint(scene, project);
    const sceneNumber = scenes.findIndex((candidate) => candidate.id === sceneId) + 1;
    try {
      setBusy(`preview:${sceneId}`);
      setPreviewErrors((current) => ({ ...current, [sceneId]: null }));
      const blob = await api.previewScene(projectId, sceneId);
      const url = URL.createObjectURL(blob);
      const preview = { url, renderedAt: Date.now(), fingerprint };
      setScenePreviews((previous) => {
        const old = previous[sceneId];
        if (old) URL.revokeObjectURL(old.url);
        const next = { ...previous, [sceneId]: preview };
        scenePreviewsRef.current = next;
        return next;
      });
      toast(`Đã render preview scene ${sceneNumber}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể tạo preview.';
      setPreviewErrors((current) => ({ ...current, [sceneId]: message }));
      toast(message);
    }
    finally { setBusy(null); }
  }

  function clearScenePreview(sceneId: string): void {
    const previous = scenePreviewsRef.current;
    const preview = previous[sceneId];
    if (!preview) return;
    URL.revokeObjectURL(preview.url);
    const next = { ...previous };
    delete next[sceneId];
    scenePreviewsRef.current = next;
    setScenePreviews(next);
    setPreviewErrors((current) => ({ ...current, [sceneId]: null }));
  }

  function startEdit(scene: Scene) { setEditingScene(scene.id); setDraftPrompt(scene.visualPrompt); }
  function startNarrationEdit(scene: Scene) { setEditingNarrationScene(scene.id); setDraftNarration(scene.narration); }
  function startMotionEdit(scene: Scene) { setEditingMotionScene(scene.id); setDraftMotionPrompt(scene.motionPrompt); }

  async function saveNarration(scene: Scene) {
    if (!project) return;
    const hadVoiceover = scene.audioFileId !== null;
    const saved = await patchScene(scene.id, { narration: draftNarration, expectedVersion: project.version });
    if (!saved) return;
    setEditingNarrationScene(null);
    if (hadVoiceover) setVoiceoverResetSceneIds((current) => new Set(current).add(scene.id));
  }

  if (projectQuery.isLoading) return <section className={styles.panel}><p>Đang tải Studio…</p></section>;
  if (projectQuery.error || !project) return <section className={styles.panel}><p className={styles.error}>Không thể tải dự án.</p></section>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><h2 className={styles.title}>Studio Phân Cảnh</h2><p className={styles.muted}>{project.title}</p><p className={styles.sceneActivitySummary}>{formatSceneActivityHeader(sceneActivity)} · Tổng thời lượng đang bật: {formatDurationSeconds(sceneActivity.activeDurationSec)}s</p></div>
        <Badge tone={statusTone[project.status]}>{statusLabel[project.status]}</Badge>
        {isRenderStale(project) && <Badge tone="amber">đã thay đổi sau lần render</Badge>}
        <select aria-label="AI provider" className={styles.audioInput} disabled={studioLocked} value={project.aiProvider} onChange={(event) => void setAiProvider(event.target.value as 'deepseek' | 'claude')}>
          {api.AI_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <AiModelSelect className={styles.modelControl} selectClassName={styles.audioInput} provider={project.aiProvider} value={project.aiModel} disabled={studioLocked} onChange={(model) => void setAiModel(model)} />
        <div className={styles.styleSelector}>
          <select aria-label="Visual style" className={styles.audioInput} disabled={studioLocked} value={project.visualStylePresetId} onChange={(event) => void setVisualStyle(event.target.value as VisualStyleId)}>
            {api.VISUAL_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className={styles.actions}>
          <Button size="sm" disabled={studioLocked} onClick={() => void copyJson()}>Copy JSON · {formatBatchSceneCount(scenes)}</Button>
          <Button size="sm" disabled={studioLocked} onClick={() => void downloadJson()}>Export JSON · {formatBatchSceneCount(scenes)}</Button>
          <input ref={fileInputRef} className={styles.hiddenInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importZip(file); }} />
          <Button size="sm" variant="amber" disabled={studioLocked} onClick={() => fileInputRef.current?.click()}>Import ZIP · {formatBatchSceneCount(scenes)}</Button>
        </div>
        <p className={styles.controlHelp}>Model AI dùng cho các tác vụ AI; phong cách chỉ áp dụng khi tạo visual prompt. JSON chứa số scene, visual/motion prompt và loại asset; ZIP ghép file theo số scene trong tên SCENE_###_....</p>
      </header>

      <section className={styles.controlArea} aria-label="Âm thanh và render">
        <div className={styles.controlGrid}>
          <section className={`${styles.controlCard} ${styles.sceneControls}`} aria-labelledby="scene-controls-title">
            <div className={styles.controlCardHead}>
              <div><h3 id="scene-controls-title" className={styles.controlTitle}>Scene &amp; hình ảnh</h3><p className={styles.muted}>Chuẩn bị hình ảnh và clip cho từng scene</p></div>
              <div className={styles.sceneAssetSummary}><strong>{filled} / {sceneActivity.activeCount} scene đang bật có asset</strong>{uploadProgress !== null && <span className={styles.muted}>Đang upload {uploadProgress}%</span>}</div>
            </div>
            <div className={styles.controlRow}><span className={styles.controlLabel}>Loại asset</span><div className={styles.actions}><Button size="sm" disabled={studioLocked} onClick={() => void setAllAssetType('image')}>All images · {formatBatchSceneCount(scenes)}</Button><Button size="sm" disabled={studioLocked} onClick={() => void setAllAssetType('video')}>All videos · {formatBatchSceneCount(scenes)}</Button></div></div>
            <p className={styles.controlHelp}>Đổi loại áp dụng cho tất cả scene; metadata riêng của loại cũ sẽ được làm mới.</p>
            <div className={styles.videoDistribution}>
              <div className={styles.videoDistributionControls}>
                <label className={styles.videoDistributionInput} htmlFor="video-distribution-percent"><span className={styles.label}>% scene video</span><input id="video-distribution-percent" className={styles.audioInput} type="number" min="0" max="100" step="5" value={videoDistributionPercent} disabled={studioLocked} onChange={(event) => { setVideoDistributionPercent(Number(event.target.value)); setVideoDistributionPreview(null); }} /></label>
                <Button size="sm" disabled={studioLocked || activeSceneList.length === 0} onClick={() => void previewVideoDistribution()}>Xem trước · {formatBatchSceneCount(scenes)}</Button>
              </div>
              <p className={styles.videoDistributionHint}>Sau khi áp dụng, bấm 'Tạo visual prompt' để AI điền motion prompt cho scene video mới.</p>
              <p className={styles.controlHelp}>Xem trước trước khi áp dụng; scene đã có asset hoặc keyframe sẽ được giữ nguyên.</p>
              {videoDistributionPreview && <div className={styles.videoDistributionPreview}>
                <p>{videoDistributionPreview.videoCount} scene video / {videoDistributionPreview.imageCount} ảnh · {videoDistributionPreview.lockedCount} scene đã có asset (giữ nguyên)</p>
                <p className={styles.videoDistributionNumbers}>{videoDistributionPreview.videoSceneNumbers.length > 0 ? `Scene ${videoDistributionPreview.videoSceneNumbers.join(', ')}` : 'Không có scene video.'}</p>
                {videoDistributionPreview.changes.length === 0 && <p className={styles.muted}>Không có thay đổi.</p>}
                <div className={styles.actions}><Button size="sm" variant="amber" disabled={studioLocked || videoDistributionPreview.changes.length === 0} onClick={() => void applyVideoDistribution()}>Áp dụng · {formatBatchSceneCount(scenes)}</Button><Button size="sm" disabled={studioLocked} onClick={() => setVideoDistributionPreview(null)}>Huỷ</Button></div>
              </div>}
            </div>
            <div className={styles.controlRow}><span className={styles.controlLabel}>AI</span><div className={styles.actions}><Button size="sm" variant="indigoline" disabled={studioLocked || scenes.length === 0} onClick={() => void splitScenes()}>Tách nhỏ scene</Button><Button size="sm" variant="indigoline" disabled={studioLocked || activeSceneList.length === 0} onClick={() => void generateVisualPrompts()}>Tạo visual prompt · {formatBatchSceneCount(scenes)}</Button></div></div>
            <p className={styles.controlHelp}>Tách nhỏ dùng AI và bỏ qua chương đã có asset, voiceover, SFX hoặc visual prompt.</p>
            <p className={styles.controlHelp}>Visual prompt bổ sung trường còn thiếu như visual và SFX; motion prompt chỉ tạo cho scene video.</p>
          </section>

          <section className={`${styles.controlCard} ${styles.audioControlsCard}`} aria-labelledby="audio-controls-title">
            <div className={styles.controlCardHead}><div><h3 id="audio-controls-title" className={styles.controlTitle}>Âm thanh</h3><p className={styles.muted}>Voiceover, SFX và BGM nền</p></div></div>
            <div className={styles.sceneTailSettings}>
              <label className={styles.transitionField} htmlFor="sfx-volume">Âm lượng SFX so với voiceover<input id="sfx-volume" className={styles.audioInput} type="number" min="0.1" max="1" step="0.05" value={sfxVolumeDraft} disabled={studioLocked} onChange={(event) => setSfxVolumeDraft(event.currentTarget.value)} onBlur={() => void saveSfxVolume()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
              <p className={styles.muted}>SFX được cân bằng về cùng mức voiceover trước khi áp dụng tỷ lệ này.</p>
              <label className={styles.transitionField} htmlFor="scene-tail-sec">Khoảng nghỉ cuối scene (giây)<input id="scene-tail-sec" className={styles.audioInput} type="number" min="0" max="2" step="0.05" value={sceneTailDraft} disabled={studioLocked} onChange={(event) => setSceneTailDraft(event.currentTarget.value)} onBlur={() => void saveSceneTail()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
              <p className={styles.muted}>Cộng thêm vào cuối mỗi voiceover. Áp dụng khi tạo voiceover mới hoặc bấm Tính lại thời lượng.</p>
              <label className={styles.transitionField} htmlFor="voice-speed">Tốc độ đọc<input id="voice-speed" className={styles.audioInput} type="number" min="0.8" max="1.3" step="0.05" value={voiceSpeedDraft} disabled={studioLocked} onChange={(event) => setVoiceSpeedDraft(event.currentTarget.value)} onBlur={() => void saveVoiceSpeed()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
              <p className={styles.muted}>Tốc độ đọc; 1.0 là bình thường. Đổi xong cần tạo lại voice.</p>
              {hasUnappliedTail && <p className={styles.muted}>Chưa áp dụng cho scene đã có voiceover — bấm Tính lại thời lượng</p>}
              <Button size="sm" variant="indigoline" disabled={studioLocked || !activeSceneList.some((scene) => scene.audioFileId)} onClick={() => void recomputeSceneDurations()}>Tính lại thời lượng theo voiceover · {formatBatchSceneCount(scenes, (scene) => Boolean(scene.audioFileId))}</Button>
            </div>
            <div className={styles.controlRow}><span className={styles.controlLabel}>Voiceover</span><div className={styles.actions}><Button size="sm" variant="indigoline" disabled={studioLocked || !activeSceneList.some((scene) => scene.narration.trim())} onClick={() => void generateAllVoiceovers()}>Tạo voiceover · {formatBatchSceneCount(scenes, (scene) => Boolean(scene.narration.trim()))}</Button><Button size="sm" variant="indigoline" disabled={studioLocked || !activeSceneList.some((scene) => scene.audioFileId)} onClick={() => void alignWordTimings()}>Căn thời gian từ · {formatBatchSceneCount(scenes, (scene) => Boolean(scene.audioFileId))}</Button><Button size="sm" variant="ghost" disabled={activeSceneList.length === 0} onClick={() => setListenMode((current) => !current)}>{listenMode ? 'Đóng nghe voiceover' : `Nghe voiceover · ${formatBatchSceneCount(scenes, (scene) => Boolean(scene.audioFileId))}`}</Button></div></div>
            <p className={styles.controlHelp}>Tạo voiceover cho scene có lời dẫn; scene lỗi được ghi riêng.</p>
            <p className={styles.controlHelp}>Căn thời gian chỉ cập nhật word timings cho voiceover WAV hiện có.</p>
            {listenMode && <VoiceoverListenPanel scenes={scenes} project={project} sceneTailInput={sceneTailDraft} audioUrls={voiceoverAudioUrls} reloadVersions={voiceoverReloadVersions} onRegenerate={regenerateVoiceover} regeneratingSceneId={busy?.startsWith('voice:') ? busy.slice('voice:'.length) : null} />}
            <div className={styles.controlRow}><span className={styles.controlLabel}>SFX</span><div className={styles.actions}><Button size="sm" variant="indigoline" disabled={studioLocked || !activeSceneList.some((scene) => scene.sfxPrompt.trim())} onClick={() => void generateAllSfx()}>Tạo tất cả SFX · {formatBatchSceneCount(scenes, (scene) => Boolean(scene.sfxPrompt.trim()))}</Button></div></div>
            <div className={styles.sfxBatchSummary} aria-live="polite"><span>SFX: {activeSceneList.filter((scene) => scene.sfxFileId !== null).length}/{activeSceneList.filter((scene) => scene.sfxPrompt.trim().length > 0).length} scene có SFX{lastSfxBatchSummary ? ` · ${lastSfxBatchSummary.failed} lỗi · bỏ qua ${lastSfxBatchSummary.skippedInactive} scene đã tắt` : ''}</span>{lastSfxBatchSummary && lastSfxBatchSummary.failed > 0 && <Button size="sm" variant="indigoline" disabled={studioLocked || !activeSceneList.some((scene) => scene.sfxPrompt.trim() && !scene.sfxFileId)} onClick={() => void regenerateMissingSfx()}>Tạo lại SFX còn thiếu · {formatBatchSceneCount(scenes, (scene) => Boolean(scene.sfxPrompt.trim() && !scene.sfxFileId))}</Button>}</div>
            <p className={styles.controlHelp}>SFX tìm trên Freesound theo prompt; scene không có prompt sẽ được bỏ qua.</p>
            <div className={styles.controlRow}><span className={styles.controlLabel}>BGM</span><div className={styles.audioActionRow}><input className={styles.audioInput} disabled={studioLocked} value={bgmMood} onChange={(event) => setBgmMood(event.target.value)} placeholder="Ví dụ: calm cinematic" /><Button size="sm" disabled={studioLocked || !bgmMood.trim()} onClick={() => void generateBgm()}>Tạo BGM</Button>{(() => { const file = project.bgmFileId ? filesById.get(project.bgmFileId) : undefined; return file && file.purpose === 'bgm' && file.mimeType.startsWith('audio/') ? <audio controls src={api.fileUrlForSummary(file)} /> : null; })()}</div></div>
            <p className={styles.controlHelp}>Tìm bản nhạc nền trên Freesound theo mood bạn nhập.</p>
          </section>

          <section className={`${styles.controlCard} ${styles.videoControlsCard}`} aria-labelledby="video-controls-title">
            <div className={styles.controlCardHead}><div><h3 id="video-controls-title" className={styles.controlTitle}>Giao diện video</h3><p className={styles.muted}>Engine và các hiệu ứng đầu ra</p></div></div>
            <div className={styles.engineRow}><span className={styles.controlLabel}>Engine</span><div className={styles.engineSelector} role="group" aria-label="Render engine">{api.RENDER_ENGINE_OPTIONS.map((option) => <Button key={option.value} size="sm" variant={api.selectedRenderEngine(project.renderEngine) === option.value ? 'indigoline' : 'ghost'} disabled={studioLocked} aria-pressed={api.selectedRenderEngine(project.renderEngine) === option.value} onClick={() => void setRenderEngine(option.value)}>{option.label}</Button>)}</div></div>
            <fieldset className={styles.remotionEffects} disabled={project.renderEngine === 'ffmpeg'}>
              <legend>Hiệu ứng Remotion</legend>
              <div className={styles.effectsGrid}>
                <label className={styles.popupToggle}><input type="checkbox" checked={project.keywordPopupsEnabled} disabled={studioLocked || project.renderEngine === 'ffmpeg'} onChange={(event) => void setKeywordPopups(event.currentTarget.checked)} /><span>Chữ pop-up</span></label>
                <label className={styles.transitionField}>Chuyển cảnh<select aria-label="Chuyển cảnh" className={styles.audioInput} value={project.transitionStyle} disabled={studioLocked || project.renderEngine === 'ffmpeg'} onChange={(event) => void setTransitionStyle(event.target.value as 'crossfade' | 'varied')}>{api.TRANSITION_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className={styles.transitionField}>Hiệu ứng phim cũ<select aria-label="Hiệu ứng phim cũ" className={styles.audioInput} value={project.filmLook} disabled={studioLocked || project.renderEngine === 'ffmpeg'} onChange={(event) => void setFilmLook(event.target.value as 'auto' | 'always' | 'off')}>{api.FILM_LOOK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className={styles.transitionField}>Hiệu ứng chiều sâu<select aria-label="Hiệu ứng chiều sâu" className={styles.audioInput} value={project.parallax} disabled={studioLocked || project.renderEngine === 'ffmpeg'} onChange={(event) => void setParallax(event.target.value as 'auto' | 'off')}>{api.PARALLAX_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <Button size="sm" variant="indigoline" disabled={studioLocked || project.renderEngine === 'ffmpeg' || !activeSceneList.some((scene) => scene.assetType === 'image' && scene.assetFileId)} onClick={() => void generateDepthMaps()}>Tạo depth map · {formatBatchSceneCount(scenes, (scene) => scene.assetType === 'image' && Boolean(scene.assetFileId))}</Button>
              </div>
              <p className={styles.controlHelp}>Các tùy chọn pop-up, chuyển cảnh, phim cũ và chiều sâu chỉ áp dụng với Remotion.</p>
              <p className={styles.controlHelp}>Tạo depth map cho scene ảnh có asset; map cùng ảnh sẽ được giữ lại.</p>
              {project.renderEngine === 'ffmpeg' && <span className={styles.renderHint}>Chỉ có ở engine Remotion</span>}
            </fieldset>
            <p className={styles.controlHelp}>FFmpeg bỏ qua hiệu ứng Remotion và logo; render nháp chỉ dùng được với Remotion.</p>
            <PopupAnalysisCard
              project={project}
              scenes={scenes}
              disabled={studioLocked}
              analysisActive={jobTask?.kind === 'popup-analysis'}
              cliAvailable={cliStatusQuery.data?.available === true}
              cliStatusText={cliStatusQuery.isLoading ? 'Đang kiểm tra Claude Code CLI…' : cliStatusQuery.data?.reason}
              summary={popupAnalysisSummary}
              onApiModelChange={setAiModel}
              onAnalyze={analyzeProjectPopups}
              onDensityChange={changePopupDensity}
              onToggleFlags={togglePopupFlags}
              onEdit={editPopup}
            />
            <ProjectLogoControl project={project} logoFile={project.logoFileId ? filesById.get(project.logoFileId) : undefined} busy={busy} setBusy={setBusy} refresh={refresh} />
          </section>

          <section className={`${styles.controlCard} ${styles.renderControlsCard}`} aria-labelledby="render-controls-title">
            <div className={styles.controlCardHead}><div><h3 id="render-controls-title" className={styles.controlTitle}>Render &amp; xuất</h3><p className={styles.muted}>Kiểm tra readiness trước khi xuất video</p></div></div>
            <section className={styles.readinessSummary} aria-label="Render readiness"><div><strong>{renderReadiness.total} scene đang bật: {renderReadiness.ready} sẵn sàng, {renderReadiness.warnings} cảnh báo, {renderReadiness.errors} lỗi</strong><p className={styles.muted}>Cảnh cảnh báo chỉ cần xác nhận; cảnh lỗi bị chặn theo khả năng render hiện tại.</p></div><details><summary>Chi tiết readiness</summary>{renderReadiness.issues.length > 0 ? <ul>{renderReadiness.issues.map((issue) => <li key={issue.sceneId}><strong>Scene {issue.sceneNumber}</strong>: {issue.messages.join(' · ')}{issue.blocking ? ' — blocker' : ''}</li>)}</ul> : <p className={styles.muted}>Tất cả scene đang bật đã sẵn sàng.</p>}</details></section>
            {popupUnreadyScenes.length > 0 && <p className={styles.warning} role="status">{popupUnreadyScenes.length}/{popupEligibleScenes.length} scene chưa có popupPlan mới; có thể phân tích lại trước khi render. Nút render không bị chặn.</p>}
            {missingScenes.length > 0 && <p className={styles.warning}>Chưa sẵn sàng render: scene {missingScenes.join(', ')} thiếu asset.</p>}
            <div className={styles.renderActions}><Button size="sm" variant="amber" disabled={studioLocked || activeSceneList.length === 0 || missingScenes.length > 0} onClick={() => requestRender()}>Render video · {formatBatchSceneCount(scenes)}</Button><Button size="sm" variant="indigoline" title="Chi co o engine Remotion" disabled={studioLocked || activeSceneList.length === 0 || missingScenes.length > 0 || project.renderEngine === 'ffmpeg'} onClick={() => requestRender(true)}>Render nháp (nhanh) · {formatBatchSceneCount(scenes)}</Button></div>
            <p className={styles.controlHelp}>Bản nháp chỉ có trên Remotion và lưu riêng, không ghi đè bản render chính.</p>
            {progress && !jobTask && <div className={styles.progress}><strong>Job {progress.status}</strong><progress max="100" value={progress.progress}>{progress.progress}%</progress><span>{progress.progress}%</span>{progress.logs.length > 0 && <ul>{progress.logs.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>}</div>}
            {(() => { const file = project.renderFileId ? filesById.get(project.renderFileId) : undefined; return file && file.purpose === 'render' && file.mimeType.startsWith('video/') ? <video className={styles.renderPlayer} controls src={api.fileUrlForSummary(file)} /> : null; })()}
            {(() => { const file = project.draftRenderFileId ? filesById.get(project.draftRenderFileId) : undefined; return file && file.purpose === 'render-draft' && file.mimeType.startsWith('video/') ? <div className={styles.draftPlayer}><strong>Bản nháp</strong><video className={styles.renderPlayer} controls src={api.fileUrlForSummary(file)} /><a href={api.fileUrlForSummary(file)} download="render-draft.mp4">Tải bản nháp</a></div> : null; })()}
          </section>
        </div>
      </section>

      {pipelineProgress && <details className={styles.pipelineProgress}>
        <summary className={styles.pipelineSummary}>
          <span className={styles.pipelineTitle}>Tiến độ pipeline</span>
          <span className={styles.pipelineOverview}>
            <span className={styles.pipelineBar} role="progressbar" aria-label="Tiến độ pipeline" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pipelineProgress.percent}><span className={styles.pipelineBarFill} style={{ width: `${pipelineProgress.percent}%` }} /></span>
            <strong>{pipelineProgress.percent}%</strong>
          </span>
        </summary>
        <div className={styles.pipelineSteps}>
          {pipelineProgress.steps.map((step) => {
            const complete = step.done === step.total && step.total > 0;
            return <div className={styles.pipelineStep} key={step.key}>
              <span>{step.label}</span>
              <span className={styles.pipelineCount}>{step.done}/{step.total}</span>
              {complete ? <span className={styles.pipelineCheck} aria-label="Hoàn thành">✓</span> : <span className={styles.pipelineStepBar}><span className={styles.pipelineStepBarFill} style={{ width: `${step.ratio * 100}%` }} /></span>}
            </div>;
          })}
        </div>
      </details>}

      {skipped.length > 0 && <details className={styles.skipped}><summary>Bỏ qua {skipped.length} file</summary><ul>{skipped.map((name) => <li key={name}>{name}</li>)}</ul></details>}

      <section className={styles.sceneList} aria-label="Danh sách scene">
        {scenes.map((scene, index) => {
          const file = scene.assetFileId ? filesById.get(scene.assetFileId) : undefined;
          const src = file ? api.fileUrlForSummary(file) : null;
          const actualType = file ? api.mediaTypeForMime(file.mimeType) : null;
          const previewType = actualType ?? scene.assetType;
          const typeMismatch = actualType !== null && actualType !== scene.assetType;
           const scenePreview = scenePreviews[scene.id];
           const readiness = readinessBySceneId.get(scene.id)!;
           const readinessBadge = readinessBadgeForStatus(readiness.status);
           const voiceoverIsFresh = scene.audioFileId !== null && scene.voiceoverInput != null && isVoiceoverFresh(scene, project);
          const sceneActive = isSceneActive(scene);
          return <article className={`${styles.card} ${sceneActive ? '' : styles.cardInactive}`} key={scene.id}>
            <div className={styles.cardHead}><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>{!sceneActive && <Badge tone="muted">Đã tắt</Badge>}<div className={styles.sceneText}><span className={styles.muted}>{formatDurationSeconds(scene.durationSec)}s{scene.assetType === 'video' && scene.videoDurationSec !== null ? ` · clip ${scene.videoDurationSec.toFixed(1)}s` : ''}</span></div><Button size="sm" variant={scene.assetType === 'video' ? 'indigoline' : 'ghost'} disabled={studioLocked} onClick={() => void patchScene(scene.id, { assetType: scene.assetType === 'image' ? 'video' : 'image' })}>{scene.assetType}</Button></div>
            <div className={`${styles.preview} ${styles.cardPreview}`}>{scenePreview ? <><video controls src={scenePreview.url} aria-label={`Preview render scene ${index + 1}`} /><div className={styles.cardPreviewLabel}><Badge tone="amber">Preview render</Badge><Button size="sm" variant="ghost" disabled={studioLocked} onClick={() => clearScenePreview(scene.id)}>Xem asset gốc</Button></div></> : src && actualType ? <>{previewType === 'video' ? <video controls src={src} /> : <img src={src} alt={`Asset scene ${index + 1}`} />}{typeMismatch && <span className={styles.mismatch}>Asset {actualType} không khớp loại scene {scene.assetType}.</span>}</> : src ? <span className={styles.placeholder}>Không thể preview loại file này.</span> : <span className={styles.placeholder}>No asset yet</span>}</div>
             <div className={styles.cardFooter}><div className={styles.statusBadges}>{readinessBadge && <span title={readiness.messages.join(' · ')}><Badge tone={readinessBadge.tone}>{readinessBadge.label}</Badge></span>}{!scene.narration.trim() && <Badge tone="amber">Không có lời dẫn</Badge>}<Badge tone={scene.visualPrompt ? 'green' : 'muted'}>{scene.visualPrompt ? 'Đã có visual prompt' : 'Chưa có visual prompt'}</Badge><Badge tone={scene.audioFileId ? (voiceoverIsFresh ? 'green' : 'amber') : 'muted'}>{scene.audioFileId ? (voiceoverIsFresh ? 'Đã có voiceover' : 'Voiceover đã cũ') : 'Chưa có voiceover'}</Badge><Badge tone={scene.sfxFileId ? 'green' : 'muted'}>{scene.sfxFileId ? 'Đã có SFX' : 'Chưa có SFX'}</Badge></div><div className={styles.cardActions}><Button size="sm" variant="indigoline" disabled={studioLocked} onClick={() => setExpandedSceneId(scene.id)}>Chi tiết</Button><SceneActiveToggle compact active={sceneActive} disabled={sceneToggleDisabled} accessibleName={`Bật/tắt scene ${index + 1}`} onChange={(active) => toggleSceneActive(scene, active)} /></div></div>
          </article>;
        })}
      </section>

      <dialog ref={detailDialogRef} className={styles.detailDialog} aria-labelledby="scene-detail-title" onClose={() => { setExpandedSceneId(null); setEditingScene(null); setEditingNarrationScene(null); setEditingMotionScene(null); }}>
        {expandedScene ? <div key={expandedScene.id} className={styles.detailContent}>
          <div className={styles.detailHeader}><div><h2 id="scene-detail-title" className={styles.detailTitle}>Scene {String(expandedSceneNumber).padStart(2, '0')}</h2><p className={styles.muted}>Chi tiết scene</p></div><Button size="sm" onClick={() => { setExpandedSceneId(null); setEditingScene(null); setEditingNarrationScene(null); setEditingMotionScene(null); }}>Đóng</Button></div>
          <div className={styles.detailBody}>
            <SceneActiveToggle active={expandedSceneActive} disabled={sceneToggleDisabled} accessibleName="Dùng scene này" label="Dùng scene này" hint="Scene tắt sẽ bị bỏ qua khi tạo asset, voice và render. Dữ liệu vẫn được giữ." onChange={(active) => toggleSceneActive(expandedScene, active)} />
            <section className={styles.detailAsset} aria-label="Asset gốc">
              <div className={styles.detailAssetHeader}><span className={styles.label}>Asset gốc</span><span className={styles.muted}>{expandedAssetFile?.originalName ?? 'Chưa có asset'}</span></div>
              {expandedAssetSrc && expandedAssetType === 'video' ? <video className={styles.detailAssetMedia} controls src={expandedAssetSrc} aria-label={`Asset gốc scene ${expandedSceneNumber}`} /> : expandedAssetSrc && expandedAssetType === 'image' ? <img className={styles.detailAssetMedia} src={expandedAssetSrc} alt={`Asset gốc scene ${expandedSceneNumber}`} /> : <span className={styles.placeholder}>Chưa có asset.</span>}
            </section>
            <ScenePreviewSection
              scene={expandedScene}
              currentScene={expandedScene}
              sceneNumber={expandedSceneNumber}
              project={project}
              preview={scenePreviews[expandedScene.id] ?? null}
              error={previewErrors[expandedScene.id] ?? null}
              studioLocked={studioLocked}
              onRender={() => void previewScene(expandedScene.id)}
            />
            {expandedScene.assetType === 'video' && <section className={styles.videoFacts} aria-label="Khung hinh video">
              <div className={styles.videoFactsHeader}><span className={styles.label}>Khung hinh video</span><span className={styles.muted}>{expandedReadiness?.messages.join(' · ')}</span></div>
              <div className={styles.videoFactsGrid}>
                {([['Keyframe', expandedScene.videoKeyframeFileId ?? (expandedScene.assetFileId && filesById.get(expandedScene.assetFileId)?.mimeType.startsWith('image/') ? expandedScene.assetFileId : null)], ['Clip', expandedScene.assetFileId && filesById.get(expandedScene.assetFileId)?.mimeType.startsWith('video/') ? expandedScene.assetFileId : null]] as const).map(([label, fileId]) => {
                  const file = fileId ? filesById.get(fileId) : undefined;
                  const src = file ? api.fileUrlForSummary(file) : null;
                  const mediaType = file ? api.mediaTypeForMime(file.mimeType) : null;
                  return <div className={styles.videoFact} key={label}><span className={styles.muted}>{label}</span>{src && mediaType === 'image' ? <img className={styles.videoFactPreview} src={src} alt={label} /> : src && mediaType === 'video' ? <video className={styles.videoFactPreview} controls src={src} /> : <span className={styles.videoFactPlaceholder}>Chưa có</span>}</div>;
                })}
              </div>
              <p className={styles.videoFactDuration}>Thời lượng scene: {formatDurationSeconds(expandedScene.durationSec)}s ({expandedScene.audioFileId ? 'từ voiceover' : 'ước tính'})</p>
              <div className={styles.actions}><span title={expandedInactiveActionTitle}><Button size="sm" variant="amber" title={expandedInactiveActionTitle ?? 'Tạo lại voiceover có thể hoàn tác thay đổi này'} disabled={!expandedSceneActive || studioLocked || expandedScene.videoDurationSec === null || Math.ceil(expandedScene.videoDurationSec) <= expandedScene.durationSec} onClick={() => void fitSceneToClip(expandedScene)}>Kéo dài scene = clip</Button></span></div>
            </section>}
            <div className={styles.prompt}><span className={styles.label}>Lời dẫn</span>{expandedNarrationEditing ? <><textarea className={styles.textarea} value={draftNarration} onChange={(event) => setDraftNarration(event.target.value)} aria-label={`Sửa lời dẫn scene ${scenes.findIndex((scene) => scene.id === expandedScene.id) + 1}`} /><div className={styles.actions}><Button size="sm" onClick={() => setEditingNarrationScene(null)}>Cancel</Button><Button size="sm" variant="amber" disabled={expandedSceneBusy || studioLocked} onClick={() => void saveNarration(expandedScene)}>Save</Button></div></> : <div className={styles.promptLine}><span>{expandedScene.narration || 'Khong co loi dan'}</span><Button size="sm" disabled={studioLocked} onClick={() => startNarrationEdit(expandedScene)}>Edit</Button></div>}</div>
            <p className={styles.nameKeywordDetail}>{nameKeywordPopupLine(expandedNamePopup)}</p>
            <div className={styles.prompt}><span className={styles.label}>Visual prompt</span>{expandedEditing ? <><textarea className={styles.textarea} value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} /><div className={styles.actions}><Button size="sm" onClick={() => setEditingScene(null)}>Cancel</Button><Button size="sm" variant="amber" disabled={expandedSceneBusy || studioLocked} onClick={() => { void patchScene(expandedScene.id, { visualPrompt: draftPrompt }); setEditingScene(null); }}>Save</Button></div></> : <div className={styles.promptLine}><span>{expandedScene.visualPrompt || 'Chưa có visual prompt.'}</span><Button size="sm" disabled={studioLocked} onClick={() => startEdit(expandedScene)}>Edit</Button></div>}</div>
            {expandedScene.assetType === 'video' && <div className={styles.prompt}><span className={styles.label}>Motion prompt</span>{expandedMotionEditing ? <><textarea className={styles.textarea} value={draftMotionPrompt} onChange={(event) => setDraftMotionPrompt(event.target.value)} /><div className={styles.actions}><Button size="sm" onClick={() => setEditingMotionScene(null)}>Cancel</Button><Button size="sm" variant="amber" disabled={expandedSceneBusy || studioLocked} onClick={() => { void patchScene(expandedScene.id, { motionPrompt: draftMotionPrompt }); setEditingMotionScene(null); }}>Save</Button></div></> : <div className={styles.promptLine}><span>{expandedScene.motionPrompt || 'Chưa có motion prompt.'}</span><Button size="sm" disabled={studioLocked} onClick={() => startMotionEdit(expandedScene)}>Edit</Button></div>}</div>}
            <div className={styles.audioControls}>
              <section className={styles.prompt}>
                <span className={styles.label}>Voiceover</span>
                {expandedVoiceoverFile?.mimeType.startsWith('audio/') ? <audio controls src={api.fileUrlForSummary(expandedVoiceoverFile)} /> : <span className={styles.placeholder}>Chưa có voiceover.</span>}
                {expandedScene.audioFileId && !isVoiceoverFresh(expandedScene, project) && <span className={styles.warning}>Voiceover đã cũ — cần tạo lại theo tốc độ/giọng hiện tại.</span>}
                {voiceoverResetSceneIds.has(expandedScene.id) && <span className={styles.warning}>Tao lai voiceover</span>}
                <div className={styles.actions}><span title={expandedInactiveActionTitle}><Button size="sm" title={expandedInactiveActionTitle} disabled={!expandedSceneActive || studioLocked || !expandedScene.narration.trim()} onClick={() => void regenerateVoiceover(expandedScene.id)}>Tạo lại voiceover</Button></span><span title={expandedInactiveActionTitle}><Button size="sm" variant="indigoline" title={expandedInactiveActionTitle} disabled={!expandedSceneActive || studioLocked} onClick={() => { setExpandedSceneId(null); setVoiceoverConfirmSceneId(expandedScene.id); }}>Chạy voiceover từ scene này</Button></span></div>
              </section>
              <section className={styles.prompt}>
                <label className={styles.label} htmlFor={`sfx-${expandedScene.id}`}>SFX prompt</label>
                <input id={`sfx-${expandedScene.id}`} className={styles.audioInput} defaultValue={expandedScene.sfxPrompt} onBlur={(event) => { if (event.currentTarget.value !== expandedScene.sfxPrompt) void patchScene(expandedScene.id, { sfxPrompt: event.currentTarget.value }); }} placeholder="Ví dụ: tiếng gió" />
                <div className={styles.actions}><span title={expandedInactiveActionTitle}><Button size="sm" title={expandedInactiveActionTitle} disabled={!expandedSceneActive || studioLocked} onClick={() => void generateSfx(expandedScene.id)}>Tạo SFX</Button></span></div>
                {expandedSfxFile?.mimeType.startsWith('audio/') ? <audio controls src={api.fileUrlForSummary(expandedSfxFile)} /> : <span className={styles.placeholder}>Chưa có SFX.</span>}
              </section>
            </div>
          </div>
        </div> : null}
      </dialog>
      <dialog ref={voiceoverConfirmDialogRef} className={styles.detailDialog} aria-labelledby="voiceover-confirm-title" onClose={() => setVoiceoverConfirmSceneId(null)}>
        <div className={styles.detailContent}>
          <div className={styles.detailHeader}><div><h2 id="voiceover-confirm-title" className={styles.detailTitle}>Chạy voiceover từ đây</h2><p className={styles.detailNarration}>{voiceoverConfirmBatchText} sẽ được tạo lại, từ scene {voiceoverConfirmStartNumber} đến scene {scenes.length}</p></div><Button size="sm" onClick={() => setVoiceoverConfirmSceneId(null)}>Huỷ</Button></div>
          <p className={styles.muted}>Batch sẽ tiếp tục qua các scene phía sau; scene không có lời dẫn sẽ được bỏ qua.</p>
          <div className={styles.actions}><Button size="sm" onClick={() => setVoiceoverConfirmSceneId(null)}>Huỷ</Button><Button size="sm" variant="amber" disabled={voiceoverConfirmStartIndex < 0 || voiceoverConfirmCount === 0} onClick={() => void continueVoiceoverFromScene()}>Chạy voiceover</Button></div>
        </div>
      </dialog>
      <dialog ref={renderConfirmDialogRef} className={styles.detailDialog} aria-labelledby="render-confirm-title" onClose={() => setRenderConfirmationDraft(null)}>
        <div className={styles.detailContent}>
          <div className={styles.detailHeader}><div><h2 id="render-confirm-title" className={styles.detailTitle}>Xác nhận render</h2><p className={styles.detailNarration}>Một số scene có cảnh báo. Bạn vẫn có thể tiếp tục render.</p></div><Button size="sm" onClick={() => setRenderConfirmationDraft(null)}>Quay lại</Button></div>
          <p className={styles.detailNarration}>{formatBatchSceneCount(scenes)} sẽ được đưa vào video.</p>
          <ul className={styles.renderConfirmList}>{renderReadiness.confirmations.map((issue) => <li key={issue.sceneId}><strong>Scene {issue.sceneNumber}</strong>: {issue.messages.join(' · ')}</li>)}</ul>
          <div className={styles.actions}><Button size="sm" onClick={() => setRenderConfirmationDraft(null)}>Quay lại</Button><Button size="sm" variant="amber" onClick={continueConfirmedRender}>Tiếp tục render</Button></div>
        </div>
      </dialog>
      {activeBlockingTask && activeBlockingStartedAt !== null && !jobLocallyUnlocked && <BlockingProgressDialog
        visible
        task={activeBlockingTask}
        jobId={jobTask ? jobId : null}
        progress={jobTask ? progress : null}
        uploadProgress={busyTask?.kind === 'import-zip' ? uploadProgress : null}
        startedAt={activeBlockingStartedAt}
        lastEventAt={jobTask ? jobLastEventAt : null}
        onCancel={jobTask ? () => void cancelActiveJob() : undefined}
        onClose={closeBlockingJob}
        onReload={jobTask ? () => void reloadActiveJob() : undefined}
        onUnlock={jobTask ? () => setJobLocallyUnlocked(true) : undefined}
      />}
    </div>
  );
}
