import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { VideoDistributionPreview } from '../../../contracts/asset';
import type { Scene, VisualStyleId } from '../../../contracts/project';
import { analyzeScene } from '../../../contracts/scene-readiness';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { toast } from '../../shared/ui/toast-store';
import { useJobProgress } from '../../shared/hooks/use-job-progress';
import { ApiError } from '../../shared/api-client';
import * as api from './api';
import { computePipelineProgress } from './pipeline-progress';
import { summarizeRenderReadiness } from './render-readiness';
import { readinessBadgeForStatus } from './scene-readiness-ui';
import { ProjectLogoControl } from './ProjectLogoControl';
import styles from './StudioPage.module.css';

const statusTone = { draft: 'muted', script: 'indigo', assets: 'green', rendered: 'green' } as const;
const statusLabel = { draft: 'Bản nháp', script: 'Kịch bản', assets: 'Đang làm asset', rendered: 'Đã render' } as const;

export function StudioPage() {
  const { projectId = '' } = useParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [editingNarrationScene, setEditingNarrationScene] = useState<string | null>(null);
  const [draftNarration, setDraftNarration] = useState('');
  const [editingMotionScene, setEditingMotionScene] = useState<string | null>(null);
  const [draftMotionPrompt, setDraftMotionPrompt] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [bgmMood, setBgmMood] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [voiceoverJobId, setVoiceoverJobId] = useState<string | null>(null);
  const [voiceoverResetSceneIds, setVoiceoverResetSceneIds] = useState<Set<string>>(new Set());
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [videoDistributionPercent, setVideoDistributionPercent] = useState(20);
  const [videoDistributionTarget, setVideoDistributionTarget] = useState(20);
  const [videoDistributionPreview, setVideoDistributionPreview] = useState<VideoDistributionPreview | null>(null);
  const [renderConfirmationDraft, setRenderConfirmationDraft] = useState<boolean | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});
  const refreshedJobRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const renderConfirmDialogRef = useRef<HTMLDialogElement>(null);
  const projectQuery = useQuery({ queryKey: ['projects', 'detail', projectId], queryFn: () => api.getProject(projectId), enabled: Boolean(projectId) });
  const filesQuery = useQuery({ queryKey: ['project-files', projectId], queryFn: () => api.listProjectFiles(projectId), enabled: Boolean(projectId) });
  const project = projectQuery.data;
  const scenes = project?.scenes ?? [];
  const files = filesQuery.data ?? [];
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const filled = scenes.filter((scene) => scene.assetFileId !== null).length;
  const missingScenes = project ? api.missingSceneNumbers(project) : [];
  const readinessBySceneId = useMemo(() => new Map(scenes.map((scene) => [scene.id, analyzeScene(scene)])), [scenes]);
  const renderReadiness = useMemo(() => summarizeRenderReadiness(scenes), [scenes]);
  const pipelineProgress = useMemo(() => project ? computePipelineProgress(project) : null, [project]);
  const expandedScene = scenes.find((scene) => scene.id === expandedSceneId) ?? null;
  const expandedEditing = expandedScene !== null && editingScene === expandedScene.id;
  const expandedNarrationEditing = expandedScene !== null && editingNarrationScene === expandedScene.id;
  const expandedMotionEditing = expandedScene !== null && editingMotionScene === expandedScene.id;
  const expandedSceneBusy = expandedScene !== null && busy === `scene:${expandedScene.id}`;
  const expandedVoiceoverFile = expandedScene?.audioFileId ? filesById.get(expandedScene.audioFileId) : undefined;
  const expandedSfxFile = expandedScene?.sfxFileId ? filesById.get(expandedScene.sfxFileId) : undefined;
  const expandedReadiness = expandedScene ? readinessBySceneId.get(expandedScene.id) : undefined;
  const progress = useJobProgress(jobId);

  useEffect(() => { if (project) setBgmMood(project.bgmMood); }, [project?.id, project?.bgmMood]);
  useEffect(() => () => { Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!jobId || !progress || !['done', 'failed', 'cancelled'].includes(progress.status) || refreshedJobRef.current === jobId) return;
    refreshedJobRef.current = jobId;
    if (progress.status === 'done' && voiceoverJobId === jobId) {
      const summary = api.voiceoverSummary(progress.result);
      if (summary) toast(summary);
      setVoiceoverJobId(null);
    }
    void refresh();
  }, [jobId, progress?.status, progress?.result, voiceoverJobId]);
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

  async function refresh() {
    await Promise.all([projectQuery.refetch(), filesQuery.refetch()]);
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

  async function generateAllVoiceovers() {
    try { setBusy('voiceover-all'); const result = await api.generateAllVoiceovers(projectId); setVoiceoverJobId(result.jobId); setJobId(result.jobId); toast('Đã xếp hàng tạo voiceover.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo voiceover.'); }
    finally { setBusy(null); }
  }

  async function fitSceneToClip(scene: Scene) {
    if (!project || scene.videoDurationSec === null) return;
    const sceneNumber = scenes.findIndex((candidate) => candidate.id === scene.id) + 1;
    try {
      setBusy(`fit-to-clip:${scene.id}`);
      const updated = await api.fitSceneToClip(projectId, scene.id, project.version);
      const nextScene = updated.scenes.find((candidate) => candidate.id === scene.id);
      await refresh();
      if (nextScene) toast(`Scene ${sceneNumber}: ${scene.durationSec}s -> ${nextScene.durationSec}s`);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể kéo dài scene theo clip.'); }
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
    try { setBusy('align-words'); const result = await api.alignWordTimings(projectId); setJobId(result.jobId); toast('Đã xếp hàng căn thời gian từng từ.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể căn thời gian từng từ.'); }
    finally { setBusy(null); }
  }

  async function generateAllSfx() {
    try { setBusy('sfx-all'); const result = await api.generateAllSfx(projectId); setJobId(result.jobId); toast('Đã xếp hàng tạo tất cả SFX.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo tất cả SFX.'); }
    finally { setBusy(null); }
  }

  async function generateVisualPrompts() {
    try { setBusy('visual-prompts'); const result = await api.generateVisualPrompts(projectId); setJobId(result.jobId); toast('Đã xếp hàng tạo visual prompt.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo visual prompt.'); }
    finally { setBusy(null); }
  }

  async function splitScenes() {
    try { setBusy('split-scenes'); const result = await api.splitScenes(projectId); setJobId(result.jobId); toast('Đã xếp hàng tách nhỏ scene.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tách nhỏ scene.'); }
    finally { setBusy(null); }
  }

  async function regenerateVoiceover(sceneId: string) {
    try { setBusy(`voice:${sceneId}`); await api.regenerateVoiceover(projectId, sceneId); await refresh(); setVoiceoverResetSceneIds((current) => { const next = new Set(current); next.delete(sceneId); return next; }); toast('Đã tạo lại voiceover.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo lại voiceover.'); }
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
    try { setBusy(draft ? 'render-draft' : 'render'); const result = await api.renderProject(projectId, draft); setJobId(result.jobId); toast(draft ? 'Đã xếp hàng render nháp.' : 'Đã xếp hàng render.'); }
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
    try { setBusy('depth-maps'); const result = await api.generateDepthMaps(projectId); setJobId(result.jobId); toast('Đã xếp hàng tạo depth map.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo depth map.'); }
    finally { setBusy(null); }
  }

  async function setAiProvider(provider: 'deepseek' | 'claude') {
    if (provider === project?.aiProvider) return;
    try { setBusy('ai-provider'); await api.setAiProvider(projectId, provider); await refresh(); toast(`Đã chọn nhà cung cấp AI ${provider === 'deepseek' ? 'DeepSeek' : 'Claude'}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi nhà cung cấp AI.'); }
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
    try {
      setBusy(`preview:${sceneId}`);
      const blob = await api.previewScene(projectId, sceneId);
      const url = URL.createObjectURL(blob);
      setPreviewUrls((previous) => {
        const old = previous[sceneId];
        if (old) URL.revokeObjectURL(old);
        const next = { ...previous, [sceneId]: url };
        previewUrlsRef.current = next;
        return next;
      });
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo preview.'); }
    finally { setBusy(null); }
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
        <div><h2 className={styles.title}>Studio Phân Cảnh</h2><p className={styles.muted}>{project.title}</p></div>
        <Badge tone={statusTone[project.status]}>{statusLabel[project.status]}</Badge>
        <select aria-label="AI provider" className={styles.audioInput} disabled={busy !== null} value={project.aiProvider} onChange={(event) => void setAiProvider(event.target.value as 'deepseek' | 'claude')}>
          {api.AI_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <div className={styles.styleSelector}>
          <select aria-label="Visual style" className={styles.audioInput} disabled={busy !== null} value={project.visualStylePresetId} onChange={(event) => void setVisualStyle(event.target.value as VisualStyleId)}>
            {api.VISUAL_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className={styles.actions}>
          <Button size="sm" disabled={busy !== null} onClick={() => void copyJson()}>Copy JSON</Button>
          <Button size="sm" disabled={busy !== null} onClick={() => void downloadJson()}>Export JSON</Button>
          <input ref={fileInputRef} className={styles.hiddenInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importZip(file); }} />
          <Button size="sm" variant="amber" disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>Import ZIP</Button>
        </div>
      </header>

      <section className={styles.controlArea} aria-label="Âm thanh và render">
        <div className={styles.controlGrid}>
          <section className={`${styles.controlCard} ${styles.sceneControls}`} aria-labelledby="scene-controls-title">
            <div className={styles.controlCardHead}>
              <div><h3 id="scene-controls-title" className={styles.controlTitle}>Scene &amp; hình ảnh</h3><p className={styles.muted}>Chuẩn bị hình ảnh và clip cho từng scene</p></div>
              <div className={styles.sceneAssetSummary}><strong>{filled} / {scenes.length} scenes have assets</strong>{uploadProgress !== null && <span className={styles.muted}>Đang upload {uploadProgress}%</span>}</div>
            </div>
            <div className={styles.controlRow}><span className={styles.controlLabel}>Loại asset</span><div className={styles.actions}><Button size="sm" disabled={busy !== null} onClick={() => void setAllAssetType('image')}>All images</Button><Button size="sm" disabled={busy !== null} onClick={() => void setAllAssetType('video')}>All videos</Button></div></div>
            <div className={styles.videoDistribution}>
              <div className={styles.videoDistributionControls}>
                <label className={styles.videoDistributionInput} htmlFor="video-distribution-percent"><span className={styles.label}>% scene video</span><input id="video-distribution-percent" className={styles.audioInput} type="number" min="0" max="100" step="5" value={videoDistributionPercent} disabled={busy !== null || api.isProjectJobActive(jobId, progress)} onChange={(event) => { setVideoDistributionPercent(Number(event.target.value)); setVideoDistributionPreview(null); }} /></label>
                <Button size="sm" disabled={busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)} onClick={() => void previewVideoDistribution()}>Xem trước</Button>
              </div>
              <p className={styles.videoDistributionHint}>Sau khi áp dụng, bấm 'Tạo visual prompt' để AI điền motion prompt cho scene video mới.</p>
              {videoDistributionPreview && <div className={styles.videoDistributionPreview}>
                <p>{videoDistributionPreview.videoCount} scene video / {videoDistributionPreview.imageCount} ảnh · {videoDistributionPreview.lockedCount} scene đã có asset (giữ nguyên)</p>
                <p className={styles.videoDistributionNumbers}>{videoDistributionPreview.videoSceneNumbers.length > 0 ? `Scene ${videoDistributionPreview.videoSceneNumbers.join(', ')}` : 'Không có scene video.'}</p>
                {videoDistributionPreview.changes.length === 0 && <p className={styles.muted}>Không có thay đổi.</p>}
                <div className={styles.actions}><Button size="sm" variant="amber" disabled={busy !== null || api.isProjectJobActive(jobId, progress) || videoDistributionPreview.changes.length === 0} onClick={() => void applyVideoDistribution()}>Áp dụng</Button><Button size="sm" disabled={busy !== null || api.isProjectJobActive(jobId, progress)} onClick={() => setVideoDistributionPreview(null)}>Huỷ</Button></div>
              </div>}
            </div>
            <div className={styles.controlRow}><span className={styles.controlLabel}>AI</span><div className={styles.actions}><Button size="sm" variant="indigoline" disabled={busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)} onClick={() => void splitScenes()}>Tách nhỏ scene</Button><Button size="sm" variant="indigoline" disabled={busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)} onClick={() => void generateVisualPrompts()}>Tạo visual prompt</Button></div></div>
          </section>

          <section className={`${styles.controlCard} ${styles.audioControlsCard}`} aria-labelledby="audio-controls-title">
            <div className={styles.controlCardHead}><div><h3 id="audio-controls-title" className={styles.controlTitle}>Âm thanh</h3><p className={styles.muted}>Voiceover, SFX và BGM nền</p></div></div>
            <div className={styles.controlRow}><span className={styles.controlLabel}>Voiceover</span><div className={styles.actions}><Button size="sm" variant="indigoline" disabled={busy !== null} onClick={() => void generateAllVoiceovers()}>Tạo voiceover</Button><Button size="sm" variant="indigoline" disabled={busy !== null || !scenes.some((scene) => scene.audioFileId) || api.isProjectJobActive(jobId, progress)} onClick={() => void alignWordTimings()}>Căn thời gian từ</Button></div></div>
            <div className={styles.controlRow}><span className={styles.controlLabel}>SFX</span><div className={styles.actions}><Button size="sm" variant="indigoline" disabled={busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)} onClick={() => void generateAllSfx()}>Tạo tất cả SFX</Button></div></div>
            <div className={styles.controlRow}><span className={styles.controlLabel}>BGM</span><div className={styles.audioActionRow}><input className={styles.audioInput} value={bgmMood} onChange={(event) => setBgmMood(event.target.value)} placeholder="Ví dụ: calm cinematic" /><Button size="sm" disabled={busy !== null || !bgmMood.trim()} onClick={() => void generateBgm()}>Tạo BGM</Button>{(() => { const file = project.bgmFileId ? filesById.get(project.bgmFileId) : undefined; return file && file.purpose === 'bgm' && file.mimeType.startsWith('audio/') ? <audio controls src={api.fileUrlForSummary(file)} /> : null; })()}</div></div>
          </section>

          <section className={`${styles.controlCard} ${styles.videoControlsCard}`} aria-labelledby="video-controls-title">
            <div className={styles.controlCardHead}><div><h3 id="video-controls-title" className={styles.controlTitle}>Giao diện video</h3><p className={styles.muted}>Engine và các hiệu ứng đầu ra</p></div></div>
            <div className={styles.engineRow}><span className={styles.controlLabel}>Engine</span><div className={styles.engineSelector} role="group" aria-label="Render engine">{api.RENDER_ENGINE_OPTIONS.map((option) => <Button key={option.value} size="sm" variant={api.selectedRenderEngine(project.renderEngine) === option.value ? 'indigoline' : 'ghost'} disabled={busy !== null} aria-pressed={api.selectedRenderEngine(project.renderEngine) === option.value} onClick={() => void setRenderEngine(option.value)}>{option.label}</Button>)}</div></div>
            <fieldset className={styles.remotionEffects} disabled={project.renderEngine === 'ffmpeg'}>
              <legend>Hiệu ứng Remotion</legend>
              <div className={styles.effectsGrid}>
                <label className={styles.popupToggle}><input type="checkbox" checked={project.keywordPopupsEnabled} disabled={busy !== null || project.renderEngine === 'ffmpeg'} onChange={(event) => void setKeywordPopups(event.currentTarget.checked)} /><span>Chữ pop-up</span></label>
                <label className={styles.transitionField}>Chuyển cảnh<select aria-label="Chuyển cảnh" className={styles.audioInput} value={project.transitionStyle} disabled={busy !== null || project.renderEngine === 'ffmpeg'} onChange={(event) => void setTransitionStyle(event.target.value as 'crossfade' | 'varied')}>{api.TRANSITION_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className={styles.transitionField}>Hiệu ứng phim cũ<select aria-label="Hiệu ứng phim cũ" className={styles.audioInput} value={project.filmLook} disabled={busy !== null || project.renderEngine === 'ffmpeg'} onChange={(event) => void setFilmLook(event.target.value as 'auto' | 'always' | 'off')}>{api.FILM_LOOK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className={styles.transitionField}>Hiệu ứng chiều sâu<select aria-label="Hiệu ứng chiều sâu" className={styles.audioInput} value={project.parallax} disabled={busy !== null || project.renderEngine === 'ffmpeg'} onChange={(event) => void setParallax(event.target.value as 'auto' | 'off')}>{api.PARALLAX_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <Button size="sm" variant="indigoline" disabled={busy !== null || project.renderEngine === 'ffmpeg' || scenes.length === 0 || api.isProjectJobActive(jobId, progress)} onClick={() => void generateDepthMaps()}>Tạo depth map</Button>
              </div>
              {project.renderEngine === 'ffmpeg' && <span className={styles.renderHint}>Chỉ có ở engine Remotion</span>}
            </fieldset>
            <ProjectLogoControl project={project} logoFile={project.logoFileId ? filesById.get(project.logoFileId) : undefined} busy={busy} setBusy={setBusy} refresh={refresh} />
          </section>

          <section className={`${styles.controlCard} ${styles.renderControlsCard}`} aria-labelledby="render-controls-title">
            <div className={styles.controlCardHead}><div><h3 id="render-controls-title" className={styles.controlTitle}>Render &amp; xuất</h3><p className={styles.muted}>Kiểm tra readiness trước khi xuất video</p></div></div>
            <section className={styles.readinessSummary} aria-label="Render readiness"><div><strong>{renderReadiness.total} scenes: {renderReadiness.ready} ready, {renderReadiness.warnings} warnings, {renderReadiness.errors} errors</strong><p className={styles.muted}>Cảnh cảnh báo chỉ cần xác nhận; cảnh lỗi bị chặn theo khả năng render hiện tại.</p></div><details><summary>Chi tiết readiness</summary>{renderReadiness.issues.length > 0 ? <ul>{renderReadiness.issues.map((issue) => <li key={issue.sceneId}><strong>Scene {issue.sceneNumber}</strong>: {issue.messages.join(' · ')}{issue.blocking ? ' — blocker' : ''}</li>)}</ul> : <p className={styles.muted}>Tất cả scene đã sẵn sàng.</p>}</details></section>
            {missingScenes.length > 0 && <p className={styles.warning}>Chưa sẵn sàng render: scene {missingScenes.join(', ')} thiếu asset.</p>}
            <div className={styles.renderActions}><Button size="sm" variant="amber" disabled={busy !== null || missingScenes.length > 0} onClick={() => requestRender()}>Render video</Button><Button size="sm" variant="indigoline" title="Chi co o engine Remotion" disabled={busy !== null || missingScenes.length > 0 || project.renderEngine === 'ffmpeg'} onClick={() => requestRender(true)}>Render nháp (nhanh)</Button></div>
            {progress && <div className={styles.progress}><strong>Job {progress.status}</strong><progress max="100" value={progress.progress}>{progress.progress}%</progress><span>{progress.progress}%</span>{progress.logs.length > 0 && <ul>{progress.logs.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>}</div>}
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
          const readiness = readinessBySceneId.get(scene.id)!;
          const readinessBadge = readinessBadgeForStatus(readiness.status);
          return <article className={styles.card} key={scene.id}>
            <div className={styles.cardHead}><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span><div className={styles.sceneText}><span className={styles.muted}>{scene.durationSec}s{scene.assetType === 'video' && scene.videoDurationSec !== null ? ` · clip ${scene.videoDurationSec.toFixed(1)}s` : ''}</span></div><Button size="sm" variant={scene.assetType === 'video' ? 'indigoline' : 'ghost'} disabled={busy !== null} onClick={() => void patchScene(scene.id, { assetType: scene.assetType === 'image' ? 'video' : 'image' })}>{scene.assetType}</Button></div>
            <div className={`${styles.preview} ${styles.cardPreview}`}>{previewUrls[scene.id] ? <video controls src={previewUrls[scene.id]} /> : src && actualType ? <>{previewType === 'video' ? <video controls src={src} /> : <img src={src} alt={`Asset scene ${index + 1}`} />}{typeMismatch && <span className={styles.mismatch}>Asset {actualType} không khớp loại scene {scene.assetType}.</span>}</> : src ? <span className={styles.placeholder}>Không thể preview loại file này.</span> : <span className={styles.placeholder}>No asset yet</span>}</div>
            <div className={styles.cardFooter}><div className={styles.statusBadges}>{readinessBadge && <span title={readiness.messages.join(' · ')}><Badge tone={readinessBadge.tone}>{readinessBadge.label}</Badge></span>}{!scene.narration.trim() && <Badge tone="amber">Không có lời dẫn</Badge>}<Badge tone={scene.visualPrompt ? 'green' : 'muted'}>{scene.visualPrompt ? 'Đã có visual prompt' : 'Chưa có visual prompt'}</Badge><Badge tone={scene.audioFileId ? 'green' : 'muted'}>{scene.audioFileId ? 'Đã có voiceover' : 'Chưa có voiceover'}</Badge><Badge tone={scene.sfxFileId ? 'green' : 'muted'}>{scene.sfxFileId ? 'Đã có SFX' : 'Chưa có SFX'}</Badge></div><Button size="sm" variant="indigoline" disabled={busy !== null} onClick={() => setExpandedSceneId(scene.id)}>Chi tiết</Button></div>
          </article>;
        })}
      </section>

      <dialog ref={detailDialogRef} className={styles.detailDialog} aria-labelledby="scene-detail-title" onClose={() => { setExpandedSceneId(null); setEditingScene(null); setEditingNarrationScene(null); setEditingMotionScene(null); }}>
        {expandedScene ? <div key={expandedScene.id} className={styles.detailContent}>
          <div className={styles.detailHeader}><div><h2 id="scene-detail-title" className={styles.detailTitle}>Scene {String(scenes.findIndex((scene) => scene.id === expandedScene.id) + 1).padStart(2, '0')}</h2><p className={styles.muted}>Chi tiết scene</p></div><Button size="sm" onClick={() => { setExpandedSceneId(null); setEditingScene(null); setEditingNarrationScene(null); setEditingMotionScene(null); }}>Đóng</Button></div>
          <div className={styles.detailBody}>
            {expandedScene.assetType === 'video' && <section className={styles.videoFacts} aria-label="Khung hinh video">
              <div className={styles.videoFactsHeader}><span className={styles.label}>Khung hinh video</span><span className={styles.muted}>{expandedReadiness?.messages.join(' · ')}</span></div>
              <div className={styles.videoFactsGrid}>
                {([['Keyframe', expandedScene.videoKeyframeFileId ?? (expandedScene.assetFileId && filesById.get(expandedScene.assetFileId)?.mimeType.startsWith('image/') ? expandedScene.assetFileId : null)], ['Khung cuoi', expandedScene.videoTailFileId], ['Clip', expandedScene.assetFileId && filesById.get(expandedScene.assetFileId)?.mimeType.startsWith('video/') ? expandedScene.assetFileId : null]] as const).map(([label, fileId]) => {
                  const file = fileId ? filesById.get(fileId) : undefined;
                  const src = file ? api.fileUrlForSummary(file) : null;
                  const mediaType = file ? api.mediaTypeForMime(file.mimeType) : null;
                  return <div className={styles.videoFact} key={label}><span className={styles.muted}>{label}</span>{src && mediaType === 'image' ? <img className={styles.videoFactPreview} src={src} alt={label} /> : src && mediaType === 'video' ? <video className={styles.videoFactPreview} controls src={src} /> : <span className={styles.videoFactPlaceholder}>Chưa có</span>}</div>;
                })}
              </div>
              <p className={styles.videoFactDuration}>Thời lượng scene: {expandedScene.durationSec}s ({expandedScene.audioFileId ? 'từ voiceover' : 'ước tính'})</p>
              <div className={styles.actions}><Button size="sm" variant="amber" title="Tạo lại voiceover có thể hoàn tác thay đổi này" disabled={busy !== null || expandedScene.videoDurationSec === null || Math.ceil(expandedScene.videoDurationSec) <= expandedScene.durationSec} onClick={() => void fitSceneToClip(expandedScene)}>Kéo dài scene = clip</Button></div>
            </section>}
            <div className={styles.prompt}><span className={styles.label}>Lời dẫn</span>{expandedNarrationEditing ? <><textarea className={styles.textarea} value={draftNarration} onChange={(event) => setDraftNarration(event.target.value)} aria-label={`Sửa lời dẫn scene ${scenes.findIndex((scene) => scene.id === expandedScene.id) + 1}`} /><div className={styles.actions}><Button size="sm" onClick={() => setEditingNarrationScene(null)}>Cancel</Button><Button size="sm" variant="amber" disabled={expandedSceneBusy} onClick={() => void saveNarration(expandedScene)}>Save</Button></div></> : <div className={styles.promptLine}><span>{expandedScene.narration || 'Khong co loi dan'}</span><Button size="sm" disabled={busy !== null} onClick={() => startNarrationEdit(expandedScene)}>Edit</Button></div>}</div>
            <div className={styles.prompt}><span className={styles.label}>Visual prompt</span>{expandedEditing ? <><textarea className={styles.textarea} value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} /><div className={styles.actions}><Button size="sm" onClick={() => setEditingScene(null)}>Cancel</Button><Button size="sm" variant="amber" disabled={expandedSceneBusy} onClick={() => { void patchScene(expandedScene.id, { visualPrompt: draftPrompt }); setEditingScene(null); }}>Save</Button></div></> : <div className={styles.promptLine}><span>{expandedScene.visualPrompt || 'Chưa có visual prompt.'}</span><Button size="sm" disabled={busy !== null} onClick={() => startEdit(expandedScene)}>Edit</Button></div>}</div>
            {expandedScene.assetType === 'video' && <div className={styles.prompt}><span className={styles.label}>Motion prompt</span>{expandedMotionEditing ? <><textarea className={styles.textarea} value={draftMotionPrompt} onChange={(event) => setDraftMotionPrompt(event.target.value)} /><div className={styles.actions}><Button size="sm" onClick={() => setEditingMotionScene(null)}>Cancel</Button><Button size="sm" variant="amber" disabled={expandedSceneBusy} onClick={() => { void patchScene(expandedScene.id, { motionPrompt: draftMotionPrompt }); setEditingMotionScene(null); }}>Save</Button></div></> : <div className={styles.promptLine}><span>{expandedScene.motionPrompt || 'Chưa có motion prompt.'}</span><Button size="sm" disabled={busy !== null} onClick={() => startMotionEdit(expandedScene)}>Edit</Button></div>}</div>}
            <div className={styles.audioControls}>
              <section className={styles.prompt}>
                <span className={styles.label}>Voiceover</span>
                {expandedVoiceoverFile?.mimeType.startsWith('audio/') ? <audio controls src={api.fileUrlForSummary(expandedVoiceoverFile)} /> : <span className={styles.placeholder}>Chưa có voiceover.</span>}
                {voiceoverResetSceneIds.has(expandedScene.id) && <span className={styles.warning}>Tao lai voiceover</span>}
                <div className={styles.actions}><Button size="sm" disabled={busy !== null || !expandedScene.narration.trim()} onClick={() => void regenerateVoiceover(expandedScene.id)}>Tạo lại voiceover</Button></div>
              </section>
              <section className={styles.prompt}>
                <label className={styles.label} htmlFor={`sfx-${expandedScene.id}`}>SFX prompt</label>
                <input id={`sfx-${expandedScene.id}`} className={styles.audioInput} defaultValue={expandedScene.sfxPrompt} onBlur={(event) => { if (event.currentTarget.value !== expandedScene.sfxPrompt) void patchScene(expandedScene.id, { sfxPrompt: event.currentTarget.value }); }} placeholder="Ví dụ: tiếng gió" />
                <div className={styles.actions}><Button size="sm" disabled={busy !== null} onClick={() => void generateSfx(expandedScene.id)}>Tạo SFX</Button></div>
                {expandedSfxFile?.mimeType.startsWith('audio/') ? <audio controls src={api.fileUrlForSummary(expandedSfxFile)} /> : <span className={styles.placeholder}>Chưa có SFX.</span>}
              </section>
              <div className={styles.actions}><Button size="sm" disabled={busy !== null} onClick={() => void previewScene(expandedScene.id)}>Preview</Button></div>
            </div>
          </div>
        </div> : null}
      </dialog>
      <dialog ref={renderConfirmDialogRef} className={styles.detailDialog} aria-labelledby="render-confirm-title" onClose={() => setRenderConfirmationDraft(null)}>
        <div className={styles.detailContent}>
          <div className={styles.detailHeader}><div><h2 id="render-confirm-title" className={styles.detailTitle}>Xác nhận render</h2><p className={styles.detailNarration}>Một số scene có cảnh báo. Bạn vẫn có thể tiếp tục render.</p></div><Button size="sm" onClick={() => setRenderConfirmationDraft(null)}>Quay lại</Button></div>
          <ul className={styles.renderConfirmList}>{renderReadiness.confirmations.map((issue) => <li key={issue.sceneId}><strong>Scene {issue.sceneNumber}</strong>: {issue.messages.join(' · ')}</li>)}</ul>
          <div className={styles.actions}><Button size="sm" onClick={() => setRenderConfirmationDraft(null)}>Quay lại</Button><Button size="sm" variant="amber" onClick={continueConfirmedRender}>Tiếp tục render</Button></div>
        </div>
      </dialog>
    </div>
  );
}
