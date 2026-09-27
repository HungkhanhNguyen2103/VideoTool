import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { Scene, VisualStyleId } from '../../../contracts/project';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { toast } from '../../shared/ui/toast-store';
import { useJobProgress } from '../../shared/hooks/use-job-progress';
import * as api from './api';
import styles from './StudioPage.module.css';

const statusTone = { draft: 'muted', script: 'indigo', assets: 'green', rendered: 'green' } as const;
const statusLabel = { draft: 'Bản nháp', script: 'Kịch bản', assets: 'Đang làm asset', rendered: 'Đã render' } as const;

export function StudioPage() {
  const { projectId = '' } = useParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [bgmMood, setBgmMood] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [stylePrompt, setStylePrompt] = useState<string | null>(null);
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const previewUrlsRef = useRef<Record<string, string>>({});
  const refreshedJobRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const styleReferenceInputRef = useRef<HTMLInputElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const projectQuery = useQuery({ queryKey: ['projects', 'detail', projectId], queryFn: () => api.getProject(projectId), enabled: Boolean(projectId) });
  const filesQuery = useQuery({ queryKey: ['project-files', projectId], queryFn: () => api.listProjectFiles(projectId), enabled: Boolean(projectId) });
  const project = projectQuery.data;
  const scenes = project?.scenes ?? [];
  const files = filesQuery.data ?? [];
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const filled = scenes.filter((scene) => scene.assetFileId !== null).length;
  const missingScenes = project ? api.missingSceneNumbers(project) : [];
  const expandedScene = scenes.find((scene) => scene.id === expandedSceneId) ?? null;
  const expandedEditing = expandedScene !== null && editingScene === expandedScene.id;
  const expandedSceneBusy = expandedScene !== null && busy === `scene:${expandedScene.id}`;
  const expandedVoiceoverFile = expandedScene?.audioFileId ? filesById.get(expandedScene.audioFileId) : undefined;
  const expandedSfxFile = expandedScene?.sfxFileId ? filesById.get(expandedScene.sfxFileId) : undefined;
  const styleReferenceFile = project?.customStyleReferenceFileId ? filesById.get(project.customStyleReferenceFileId) : undefined;
  const progress = useJobProgress(jobId);

  useEffect(() => { if (project) setBgmMood(project.bgmMood); }, [project?.id, project?.bgmMood]);
  useEffect(() => () => { Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!jobId || !progress || !['done', 'failed', 'cancelled'].includes(progress.status) || refreshedJobRef.current === jobId) return;
    refreshedJobRef.current = jobId;
    void refresh();
  }, [jobId, progress?.status]);
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

  async function uploadStyleReference(file: File) {
    try {
      setBusy('style-reference');
      const uploaded = await api.uploadStyleReference(projectId, file);
      await api.setCustomStyleReferenceFile(projectId, uploaded.id);
      await refresh();
      toast('Đã cập nhật ảnh tham chiếu phong cách.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể upload ảnh tham chiếu.'); }
    finally { setBusy(null); if (styleReferenceInputRef.current) styleReferenceInputRef.current.value = ''; }
  }

  async function clearStyleReference() {
    try {
      setBusy('style-reference');
      await api.setCustomStyleReferenceFile(projectId, null);
      await refresh();
      toast('Đã xóa ảnh tham chiếu phong cách.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể xóa ảnh tham chiếu.'); }
    finally { setBusy(null); }
  }

  async function getVisualStylePrompt() {
    try {
      setBusy('style-prompt');
      const result = await api.getVisualStylePrompt(projectId);
      setStylePrompt(result.style);
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể lấy style prompt.'); }
    finally { setBusy(null); }
  }

  async function patchScene(sceneId: string, body: { visualPrompt?: string; assetType?: 'image' | 'video'; sfxPrompt?: string }) {
    try { setBusy(`scene:${sceneId}`); await api.patchScene(projectId, sceneId, body); await refresh(); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật scene.'); }
    finally { setBusy(null); }
  }

  async function setAllAssetType(assetType: 'image' | 'video') {
    try { setBusy('type'); await api.setAllAssetType(projectId, assetType); await refresh(); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi loại asset.'); }
    finally { setBusy(null); }
  }

  async function generateAllVoiceovers() {
    try { setBusy('voiceover-all'); const result = await api.generateAllVoiceovers(projectId); setJobId(result.jobId); toast('Đã xếp hàng tạo voiceover.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo voiceover.'); }
    finally { setBusy(null); }
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
    try { setBusy(`voice:${sceneId}`); await api.regenerateVoiceover(projectId, sceneId); await refresh(); toast('Đã tạo lại voiceover.'); }
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

  async function renderProject() {
    try { setBusy('render'); const result = await api.renderProject(projectId); setJobId(result.jobId); toast('Đã xếp hàng render.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể render.'); }
    finally { setBusy(null); }
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

  async function setAiProvider(provider: 'deepseek' | 'claude') {
    if (provider === project?.aiProvider) return;
    try { setBusy('ai-provider'); await api.setAiProvider(projectId, provider); await refresh(); toast(`Đã chọn nhà cung cấp AI ${provider === 'deepseek' ? 'DeepSeek' : 'Claude'}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi nhà cung cấp AI.'); }
    finally { setBusy(null); }
  }

  async function setVisualStyle(visualStylePresetId: VisualStyleId) {
    if (visualStylePresetId === project?.visualStylePresetId) return;
    const label = api.VISUAL_STYLE_OPTIONS.find((option) => option.value === visualStylePresetId)?.label ?? visualStylePresetId;
    try { setBusy('visual-style'); await api.setVisualStyle(projectId, visualStylePresetId); setStylePrompt(null); await refresh(); toast(`Đã chọn phong cách hình ảnh ${label}.`); }
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
        <div className={styles.styleReferenceControls}>
          <select aria-label="Visual style" className={styles.audioInput} disabled={busy !== null} value={project.visualStylePresetId} onChange={(event) => void setVisualStyle(event.target.value as VisualStyleId)}>
            {api.VISUAL_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input ref={styleReferenceInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadStyleReference(file); }} />
          <Button size="sm" disabled={busy !== null} onClick={() => styleReferenceInputRef.current?.click()}>{project.customStyleReferenceFileId ? 'Thay ảnh' : 'Upload ảnh'}</Button>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void getVisualStylePrompt()}>Get prompt</Button>
          {styleReferenceFile?.purpose === 'style-reference' && styleReferenceFile.mimeType.startsWith('image/') ? <img className={styles.styleReferenceImage} src={api.fileUrlForSummary(styleReferenceFile)} alt="Ảnh tham chiếu phong cách" /> : null}
          {project.customStyleReferenceFileId ? <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void clearStyleReference()}>Xóa ảnh</Button> : null}
        </div>
        <div className={styles.actions}>
          <Button size="sm" disabled={busy !== null} onClick={() => void copyJson()}>Copy JSON</Button>
          <Button size="sm" disabled={busy !== null} onClick={() => void downloadJson()}>Export JSON</Button>
          <input ref={fileInputRef} className={styles.hiddenInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importZip(file); }} />
          <Button size="sm" variant="amber" disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>Import ZIP</Button>
        </div>
      </header>

      {stylePrompt !== null && <section className={styles.stylePrompt} aria-label="Visual style prompt"><label className={styles.label} htmlFor="visual-style-prompt">Style prompt</label><textarea id="visual-style-prompt" className={styles.textarea} readOnly value={stylePrompt} /></section>}

      <div className={styles.toolbar}>
        <strong>{filled} / {scenes.length} scenes have assets</strong>
        {uploadProgress !== null && <span className={styles.muted}>Đang upload {uploadProgress}%</span>}
        <div className={styles.actions}><Button size="sm" disabled={busy !== null} onClick={() => void setAllAssetType('image')}>All images</Button><Button size="sm" disabled={busy !== null} onClick={() => void setAllAssetType('video')}>All videos</Button><Button size="sm" variant="indigoline" disabled={busy !== null} onClick={() => void generateAllVoiceovers()}>Tạo voiceover</Button><Button size="sm" variant="indigoline" disabled={busy !== null || !scenes.some((scene) => scene.audioFileId) || api.isProjectJobActive(jobId, progress)} onClick={() => void alignWordTimings()}>Căn thời gian từ</Button><Button size="sm" variant="indigoline" disabled={busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)} onClick={() => void generateAllSfx()}>Tạo tất cả SFX</Button><Button size="sm" variant="indigoline" disabled={busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)} onClick={() => void generateVisualPrompts()}>Tạo visual prompt</Button><Button size="sm" variant="indigoline" disabled={busy !== null || scenes.length === 0 || api.isProjectJobActive(jobId, progress)} onClick={() => void splitScenes()}>Tách nhỏ scene</Button><Button size="sm" variant="amber" disabled={busy !== null || missingScenes.length > 0} onClick={() => void renderProject()}>Render video</Button></div>
      </div>

      <section className={styles.mediaPanel} aria-label="Âm thanh và render">
        <div className={styles.mediaHeader}><div><strong>BGM nền</strong><p className={styles.muted}>Tìm nhạc ambient theo mood</p></div><div className={styles.renderControls}><div className={styles.engineSelector} role="group" aria-label="Render engine">{api.RENDER_ENGINE_OPTIONS.map((option) => <Button key={option.value} size="sm" variant={api.selectedRenderEngine(project.renderEngine) === option.value ? 'indigoline' : 'ghost'} disabled={busy !== null} aria-pressed={api.selectedRenderEngine(project.renderEngine) === option.value} onClick={() => void setRenderEngine(option.value)}>{option.label}</Button>)}</div><label className={styles.popupToggle}><input type="checkbox" checked={project.keywordPopupsEnabled} disabled={busy !== null || project.renderEngine === 'ffmpeg'} onChange={(event) => void setKeywordPopups(event.currentTarget.checked)} /><span>Chữ pop-up</span></label>{project.renderEngine === 'ffmpeg' && <span className={styles.renderHint}>Chỉ áp dụng cho Remotion.</span>}</div></div>
        <div className={styles.actions}><input className={styles.audioInput} value={bgmMood} onChange={(event) => setBgmMood(event.target.value)} placeholder="Ví dụ: calm cinematic" /><Button size="sm" disabled={busy !== null || !bgmMood.trim()} onClick={() => void generateBgm()}>Tạo BGM</Button>{(() => { const file = project.bgmFileId ? filesById.get(project.bgmFileId) : undefined; return file && file.purpose === 'bgm' && file.mimeType.startsWith('audio/') ? <audio controls src={api.fileUrlForSummary(file)} /> : null; })()}</div>
        {(() => { const file = project.renderFileId ? filesById.get(project.renderFileId) : undefined; return file && file.purpose === 'render' && file.mimeType.startsWith('video/') ? <video className={styles.renderPlayer} controls src={api.fileUrlForSummary(file)} /> : null; })()}
        {missingScenes.length > 0 && <p className={styles.warning}>Chưa sẵn sàng render: scene {missingScenes.join(', ')} thiếu asset.</p>}
        {progress && <div className={styles.progress}><strong>Job {progress.status}</strong><progress max="100" value={progress.progress}>{progress.progress}%</progress><span>{progress.progress}%</span>{progress.logs.length > 0 && <ul>{progress.logs.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>}</div>}
      </section>

      {skipped.length > 0 && <details className={styles.skipped}><summary>Bỏ qua {skipped.length} file</summary><ul>{skipped.map((name) => <li key={name}>{name}</li>)}</ul></details>}

      <section className={styles.sceneList} aria-label="Danh sách scene">
        {scenes.map((scene, index) => {
          const file = scene.assetFileId ? filesById.get(scene.assetFileId) : undefined;
          const src = file ? api.fileUrlForSummary(file) : null;
          const actualType = file ? api.mediaTypeForMime(file.mimeType) : null;
          const previewType = actualType ?? scene.assetType;
          const typeMismatch = actualType !== null && actualType !== scene.assetType;
          return <article className={styles.card} key={scene.id}>
            <div className={styles.cardHead}><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span><div className={styles.sceneText}><span className={styles.muted}>{scene.durationSec}s</span></div><Button size="sm" variant={scene.assetType === 'video' ? 'indigoline' : 'ghost'} disabled={busy !== null} onClick={() => void patchScene(scene.id, { assetType: scene.assetType === 'image' ? 'video' : 'image' })}>{scene.assetType}</Button></div>
            <div className={`${styles.preview} ${styles.cardPreview}`}>{previewUrls[scene.id] ? <video controls src={previewUrls[scene.id]} /> : src && actualType ? <>{previewType === 'video' ? <video controls src={src} /> : <img src={src} alt={`Asset scene ${index + 1}`} />}{typeMismatch && <span className={styles.mismatch}>Asset {actualType} không khớp loại scene {scene.assetType}.</span>}</> : src ? <span className={styles.placeholder}>Không thể preview loại file này.</span> : <span className={styles.placeholder}>No asset yet</span>}</div>
            <div className={styles.cardFooter}><div className={styles.statusBadges}><Badge tone={scene.visualPrompt ? 'green' : 'muted'}>{scene.visualPrompt ? 'Đã có visual prompt' : 'Chưa có visual prompt'}</Badge><Badge tone={scene.audioFileId ? 'green' : 'muted'}>{scene.audioFileId ? 'Đã có voiceover' : 'Chưa có voiceover'}</Badge><Badge tone={scene.sfxFileId ? 'green' : 'muted'}>{scene.sfxFileId ? 'Đã có SFX' : 'Chưa có SFX'}</Badge></div><Button size="sm" variant="indigoline" disabled={busy !== null} onClick={() => setExpandedSceneId(scene.id)}>Chi tiết</Button></div>
          </article>;
        })}
      </section>

      <dialog ref={detailDialogRef} className={styles.detailDialog} aria-labelledby="scene-detail-title" onClose={() => { setExpandedSceneId(null); setEditingScene(null); }}>
        {expandedScene ? <div key={expandedScene.id} className={styles.detailContent}>
          <div className={styles.detailHeader}><div><h2 id="scene-detail-title" className={styles.detailTitle}>Scene {String(scenes.findIndex((scene) => scene.id === expandedScene.id) + 1).padStart(2, '0')}</h2><p className={styles.detailNarration}>{expandedScene.narration}</p></div><Button size="sm" onClick={() => { setExpandedSceneId(null); setEditingScene(null); }}>Đóng</Button></div>
          <div className={styles.detailBody}>
            <div className={styles.prompt}><span className={styles.label}>Visual prompt</span>{expandedEditing ? <><textarea className={styles.textarea} value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} /><div className={styles.actions}><Button size="sm" onClick={() => setEditingScene(null)}>Cancel</Button><Button size="sm" variant="amber" disabled={expandedSceneBusy} onClick={() => { void patchScene(expandedScene.id, { visualPrompt: draftPrompt }); setEditingScene(null); }}>Save</Button></div></> : <div className={styles.promptLine}><span>{expandedScene.visualPrompt || 'Chưa có visual prompt.'}</span><Button size="sm" disabled={busy !== null} onClick={() => startEdit(expandedScene)}>Edit</Button></div>}</div>
            <div className={styles.audioControls}>
              <section className={styles.prompt}>
                <span className={styles.label}>Voiceover</span>
                {expandedVoiceoverFile?.mimeType.startsWith('audio/') ? <audio controls src={api.fileUrlForSummary(expandedVoiceoverFile)} /> : <span className={styles.placeholder}>Chưa có voiceover.</span>}
                <div className={styles.actions}><Button size="sm" disabled={busy !== null} onClick={() => void regenerateVoiceover(expandedScene.id)}>Tạo lại voiceover</Button></div>
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
    </div>
  );
}
