import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { Scene } from '../../../contracts/project';
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
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const previewUrlsRef = useRef<Record<string, string>>({});
  const refreshedJobRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectQuery = useQuery({ queryKey: ['projects', 'detail', projectId], queryFn: () => api.getProject(projectId), enabled: Boolean(projectId) });
  const filesQuery = useQuery({ queryKey: ['project-files', projectId], queryFn: () => api.listProjectFiles(projectId), enabled: Boolean(projectId) });
  const project = projectQuery.data;
  const scenes = project?.scenes ?? [];
  const files = filesQuery.data ?? [];
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const filled = scenes.filter((scene) => scene.assetFileId !== null).length;
  const missingScenes = project ? api.missingSceneNumbers(project) : [];
  const progress = useJobProgress(jobId);

  useEffect(() => { if (project) setBgmMood(project.bgmMood); }, [project?.id, project?.bgmMood]);
  useEffect(() => () => { Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!jobId || !progress || !['done', 'failed', 'cancelled'].includes(progress.status) || refreshedJobRef.current === jobId) return;
    refreshedJobRef.current = jobId;
    void refresh();
  }, [jobId, progress?.status]);

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
        <div className={styles.actions}>
          <Button size="sm" disabled={busy !== null} onClick={() => void copyJson()}>Copy JSON</Button>
          <Button size="sm" disabled={busy !== null} onClick={() => void downloadJson()}>Export JSON</Button>
          <input ref={fileInputRef} className={styles.hiddenInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importZip(file); }} />
          <Button size="sm" variant="amber" disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>Import ZIP</Button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <strong>{filled} / {scenes.length} scenes have assets</strong>
        {uploadProgress !== null && <span className={styles.muted}>Đang upload {uploadProgress}%</span>}
        <div className={styles.actions}><Button size="sm" disabled={busy !== null} onClick={() => void setAllAssetType('image')}>All images</Button><Button size="sm" disabled={busy !== null} onClick={() => void setAllAssetType('video')}>All videos</Button><Button size="sm" variant="indigoline" disabled={busy !== null} onClick={() => void generateAllVoiceovers()}>Tạo voiceover</Button><Button size="sm" variant="amber" disabled={busy !== null || missingScenes.length > 0} onClick={() => void renderProject()}>Render video</Button></div>
      </div>

      <section className={styles.mediaPanel} aria-label="Âm thanh và render">
        <div className={styles.mediaHeader}><div><strong>BGM nền</strong><p className={styles.muted}>Tìm nhạc ambient theo mood</p></div><span className={styles.engineBadge}>{project.renderEngine === 'ffmpeg' ? 'FFmpeg' : 'Remotion'}</span></div>
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
          const editing = editingScene === scene.id;
          const sceneBusy = busy === `scene:${scene.id}`;
          return <article className={styles.card} key={scene.id}>
            <div className={styles.cardHead}><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span><div className={styles.sceneText}><strong>{scene.narration.slice(0, 80)}{scene.narration.length > 80 ? '…' : ''}</strong><span className={styles.muted}>{scene.durationSec}s</span></div><Button size="sm" variant={scene.assetType === 'video' ? 'indigoline' : 'ghost'} disabled={busy !== null} onClick={() => void patchScene(scene.id, { assetType: scene.assetType === 'image' ? 'video' : 'image' })}>{scene.assetType}</Button></div>
            <div className={styles.body}>
              <div className={styles.prompt}><span className={styles.label}>Visual prompt</span>{editing ? <><textarea className={styles.textarea} value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} /><div className={styles.actions}><Button size="sm" onClick={() => setEditingScene(null)}>Cancel</Button><Button size="sm" variant="amber" disabled={sceneBusy} onClick={() => { void patchScene(scene.id, { visualPrompt: draftPrompt }); setEditingScene(null); }}>Save</Button></div></> : <div className={styles.promptLine}><span>{scene.visualPrompt || 'Chưa có visual prompt.'}</span><Button size="sm" disabled={busy !== null} onClick={() => startEdit(scene)}>Edit</Button></div>}</div>
              <div className={styles.audioControls}>
                <label className={styles.label} htmlFor={`sfx-${scene.id}`}>SFX prompt</label>
                <input id={`sfx-${scene.id}`} className={styles.audioInput} defaultValue={scene.sfxPrompt} onBlur={(event) => { if (event.currentTarget.value !== scene.sfxPrompt) void patchScene(scene.id, { sfxPrompt: event.currentTarget.value }); }} placeholder="Ví dụ: tiếng gió" />
                <div className={styles.actions}><Button size="sm" disabled={busy !== null} onClick={() => void generateSfx(scene.id)}>Tạo SFX</Button><Button size="sm" disabled={busy !== null} onClick={() => void regenerateVoiceover(scene.id)}>Tạo lại voiceover</Button><Button size="sm" disabled={busy !== null} onClick={() => void previewScene(scene.id)}>Preview</Button></div>
                {scene.audioFileId && filesById.get(scene.audioFileId)?.mimeType.startsWith('audio/') && <audio controls src={api.fileUrlForSummary(filesById.get(scene.audioFileId)!)} />}
                {scene.sfxFileId && filesById.get(scene.sfxFileId)?.mimeType.startsWith('audio/') && <audio controls src={api.fileUrlForSummary(filesById.get(scene.sfxFileId)!)} />}
              </div>
              <div className={styles.preview}>{previewUrls[scene.id] ? <video controls src={previewUrls[scene.id]} /> : src && actualType ? <>{previewType === 'video' ? <video controls src={src} /> : <img src={src} alt={`Asset scene ${index + 1}`} />}{typeMismatch && <span className={styles.mismatch}>Asset {actualType} không khớp loại scene {scene.assetType}.</span>}</> : src ? <span className={styles.placeholder}>Không thể preview loại file này.</span> : <span className={styles.placeholder}>No asset yet</span>}</div>
            </div>
          </article>;
        })}
      </section>
    </div>
  );
}
