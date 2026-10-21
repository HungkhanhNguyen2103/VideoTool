import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SEO_SECTIONS, SEO_THUMBNAIL_MAX_BYTES, type SeoSection } from '../../../contracts/seo';
import { aiModelForProviderChange } from '../../shared/ai/AiModelSelect';
import { buildPackageMarkdown, slugifyPackageTitle } from '../../../contracts/seo-format';
import { Button } from '../../shared/ui/Button';
import { toast } from '../../shared/ui/toast-store';
import { useJobProgress } from '../../shared/hooks/use-job-progress';
import { useSeoDraft, useSeoProject } from './hooks';
import * as api from './api';
import { buildSeoDisplay, AI_PROVIDER_LABELS, saveStateLabel } from './seo-view';
import { Toolbar } from './components/Toolbar';
import { TitlesPanel } from './components/TitlesPanel';
import { DescriptionPanel } from './components/DescriptionPanel';
import { TagsPanel } from './components/TagsPanel';
import { PinnedCommentPanel } from './components/PinnedCommentPanel';
import { ThumbnailPanel } from './components/ThumbnailPanel';
import { ManualSeoPanel } from './components/ManualSeoPanel';
import { PublishPanel } from './components/PublishPanel';
import { ChannelManagerDialog } from '../channel/components/ChannelManagerDialog';
import { HISTORY_CHANNEL_PREFILL } from '../channel/channel-helpers';
import { useChannel, useChannels } from '../channel/hooks';
import { useSetProjectChannel } from '../project/hooks';
import styles from './SeoPage.module.css';

export function SeoPage() {
  const { projectId = '' } = useParams();
  const { project: projectQuery, files: filesQuery } = useSeoProject(projectId);
  const project = projectQuery.data;
  const channelsQuery = useChannels();
  const channelQuery = useChannel(project?.channelId);
  const channel = channelQuery.data;
  const setChannelMutation = useSetProjectChannel();
  const { draft, saveState, update, flush } = useSeoDraft(projectId, project?.seo);
  const [mode, setMode] = useState<'automatic' | 'manual'>('automatic');
  const [busy, setBusy] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualRaw, setManualRaw] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manageChannels, setManageChannels] = useState(false);
  const [channelPrefill, setChannelPrefill] = useState<typeof HISTORY_CHANNEL_PREFILL | null>(null);
  const progress = useJobProgress(jobId);
  const seo = draft ?? project?.seo;
  const files = filesQuery.data ?? [];
  const thumbnailFile = seo?.thumbnail.fileId ? files.find((file) => file.id === seo.thumbnail.fileId) : undefined;
  const renderFile = project?.renderFileId ? files.find((file) => file.id === project.renderFileId) : undefined;
  const activeJob = progress !== null && ['queued', 'running'].includes(progress.status);
  const allSections = useMemo<SeoSection[]>(() => [...SEO_SECTIONS], []);

  useEffect(() => {
    if (!jobId || !progress || !['done', 'failed', 'cancelled'].includes(progress.status)) return;
    if (progress.status === 'done') toast('Đã tạo xong gói SEO.');
    else toast(progress.error ?? 'Tạo gói SEO thất bại.');
    void projectQuery.refetch();
    void filesQuery.refetch();
    setBusy(null);
    setJobId(null);
  }, [jobId, progress?.status, progress?.error]);

  async function refresh() {
    await Promise.all([projectQuery.refetch(), filesQuery.refetch()]);
  }

  async function generate(sections: SeoSection[]) {
    if (!project || activeJob) return;
    const hasContent = sections.some((section) => {
      if (section === 'titles') return seo?.titles.length;
      if (section === 'description') return Boolean(seo && (seo.descriptionIntro.trim() || seo.descriptionKeywords.trim()));
      if (section === 'tags') return Boolean(seo?.tags.length || seo?.hashtags.length);
      if (section === 'pinnedComment') return Boolean(seo?.pinnedComment.trim());
      return Boolean(seo?.thumbnail.ideas.length);
    });
    if (hasContent && !window.confirm('Phần này đã có nội dung. Tạo lại sẽ thay thế nội dung phần đã chọn, tiếp tục?')) return;
    try {
      setBusy('generate');
      const result = await api.generateSeo(project.id, sections);
      setJobId(result.jobId);
      toast('Đã xếp hàng tạo gói SEO.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể tạo gói SEO.');
      setBusy(null);
    }
  }

  async function changeProvider(provider: 'deepseek' | 'claude', model?: string) {
    if (!project || provider === project.aiProvider) return;
    try { setBusy('provider'); await api.setSeoAiProvider(project.id, provider, model); await projectQuery.refetch(); toast(model ? 'Đã đổi model AI.' : `Đã chọn ${AI_PROVIDER_LABELS[provider]}.`); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi cấu hình AI.'); }
    finally { setBusy(null); }
  }

  async function changeModel(model: string) {
    if (!project || model === project.aiModel || controlsBusy) return;
    try { setBusy('ai-model'); await api.setSeoAiProvider(project.id, project.aiProvider, model); await projectQuery.refetch(); toast('Đã chọn model AI.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể đổi model AI.'); }
    finally { setBusy(null); }
  }

  async function loadManualPrompt() {
    if (!project) return;
    try {
      setBusy('prompt');
      const result = await api.getSeoManualPrompt(project.id, allSections);
      setManualPrompt(result.prompt);
      await navigator.clipboard.writeText(result.prompt);
      toast('Đã sao chép prompt. Dán prompt vào AI bất kỳ rồi dán JSON kết quả vào ô bên dưới.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể lấy prompt.'); }
    finally { setBusy(null); }
  }

  async function importManual() {
    if (!project || !manualRaw.trim()) return;
    try { setBusy('import'); setManualError(null); await api.importSeo(project.id, manualRaw, allSections); await refresh(); toast('Đã nhập gói SEO thủ công.'); }
    catch (error) { const message = error instanceof Error ? error.message : 'Không thể nhập JSON.'; setManualError(message); toast(message); }
    finally { setBusy(null); }
  }

  async function uploadThumbnail(file: File) {
    if (!project) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { toast('Thumbnail phải là PNG hoặc JPEG.'); return; }
    if (file.size > SEO_THUMBNAIL_MAX_BYTES) { toast('Thumbnail phải nhỏ hơn hoặc bằng 2 MB.'); return; }
    try { setBusy('thumbnail'); await api.uploadSeoThumbnail(project.id, file); await refresh(); toast('Đã tải thumbnail.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể tải thumbnail.'); }
    finally { setBusy(null); }
  }

  async function removeThumbnail() {
    if (!project) return;
    try { setBusy('thumbnail'); await api.removeSeoThumbnail(project.id); await refresh(); toast('Đã xoá thumbnail.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể xoá thumbnail.'); }
    finally { setBusy(null); }
  }

  async function copyPackage() {
    if (!project || !seo) return;
    try { await flush(); await navigator.clipboard.writeText(buildPackageMarkdown({ ...project, seo }, channel)); toast('Đã sao chép toàn bộ gói đăng.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Không thể sao chép gói đăng.'); }
  }

  async function downloadPackage() {
    if (!project || !seo) return;
    try {
      await flush();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([buildPackageMarkdown({ ...project, seo }, channel)], { type: 'text/markdown;charset=utf-8' }));
      link.download = `${slugifyPackageTitle(seo.titles.find((title) => title.id === seo.chosenTitleId)?.text ?? project.title)}.md`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast('Đã tải gói đăng Markdown.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tải gói đăng.'); }
  }

  async function assignChannel(channelId: string | null) {
    if (!project || channelId === project.channelId) return;
    try {
      await setChannelMutation.mutateAsync({ projectId: project.id, channelId });
      toast('Đã cập nhật kênh của dự án.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể cập nhật kênh.');
    }
  }

  if (projectQuery.isLoading) return <div className={styles.loading}>Đang tải gói SEO…</div>;
  if (projectQuery.error || !project || !seo) return <div className={styles.errorBox}>Không thể tải dữ liệu SEO.</div>;

  const pageHeader = <header className={styles.header}><div><p className={styles.eyebrow}>BƯỚC 4 · ĐÓNG GÓI VIDEO</p><h1>SEO &amp; Đóng Gói Kênh</h1><p className={styles.muted}>Tạo một gói đăng YouTube hấp dẫn nhưng trung thực với nội dung video.</p></div><span className={styles.saveState}>{saveStateLabel(saveState)}</span></header>;
  const channelSection = <section className={`${styles.channelSection} ${styles.panel}`} aria-labelledby="seo-channel-title">
    <div className={styles.panelHead}>
      <div><h2 id="seo-channel-title">Kênh</h2><p className={styles.muted}>Chọn hồ sơ kênh dùng cho gói đăng của dự án.</p></div>
      <div className={styles.channelActions}>
        <Button size="sm" onClick={() => setManageChannels(true)}>Quản lý kênh</Button>
        <Button size="sm" onClick={() => { setChannelPrefill(HISTORY_CHANNEL_PREFILL); setManageChannels(true); }}>Dùng mẫu Lịch Sử Không Khô</Button>
      </div>
    </div>
    <label className={styles.channelSelect} htmlFor="seo-channel-select">Kênh của dự án
      <select id="seo-channel-select" className={styles.input} value={project.channelId ?? ''} disabled={channelsQuery.isLoading || setChannelMutation.isPending} onChange={(event) => void assignChannel(event.target.value || null)}>
        <option value="">Chưa chọn kênh</option>
        {(channelsQuery.data ?? []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}{channel.handle ? ` · ${channel.handle}` : ''}</option>)}
      </select>
    </label>
    {channelsQuery.error && <p className={styles.error}>Không tải được danh sách kênh.</p>}
  </section>;
  const channelDialog = <ChannelManagerDialog open={manageChannels} prefill={channelPrefill} onPrefillConsumed={() => setChannelPrefill(null)} onClose={() => setManageChannels(false)} />;

  if (project.chapters.length === 0) return <main className={styles.page}>{pageHeader}{channelSection}<section className={styles.emptyState}><h2>Chưa có chương</h2><p>Dự án chưa có chương. Hãy quay lại tab 2 để tạo và duyệt kịch bản trước.</p></section>{channelDialog}</main>;

  const readyDisplay = buildSeoDisplay({ ...project, seo }, channel);
  const controlsBusy = Boolean(busy || activeJob);
  return <main className={styles.page}>
    {pageHeader}
    {channelSection}
    <Toolbar mode={mode} provider={project.aiProvider} model={project.aiModel} busy={controlsBusy} sections={allSections} hasRaw={Boolean(manualRaw.trim())} onModeChange={setMode} onProviderChange={(provider) => void changeProvider(provider, aiModelForProviderChange(provider, project.aiProvider, project.aiModel))} onModelChange={(model) => void changeModel(model)} onGenerate={() => void generate(allSections)} onLoadPrompt={() => void loadManualPrompt()} onImport={() => void importManual()} />
    {activeJob && <div className={styles.jobProgress} role="status"><span>Đang tạo gói SEO…</span><progress value={progress?.progress ?? 0} max={100} /> <span>{progress?.progress ?? 0}%</span></div>}
    {readyDisplay.unsupportedFacts.length > 0 && <aside className={styles.factWarning}><strong>Kiểm tra số liệu</strong><ul>{readyDisplay.unsupportedFacts.map((fact) => <li key={fact}>Số liệu “{fact}” chưa thấy trong dữ liệu nguồn. Đây là cảnh báo, không chặn.</li>)}</ul></aside>}
    {mode === 'manual' && <ManualSeoPanel prompt={manualPrompt} raw={manualRaw} error={manualError} busy={controlsBusy} sections={allSections} onRawChange={setManualRaw} onLoadPrompt={() => void loadManualPrompt()} onImport={() => void importManual()} />}
    <div className={styles.grid}>
      <TitlesPanel seo={seo} busy={controlsBusy} onPatch={update} onRegenerate={() => void generate(['titles'])} onFlush={() => void flush()} />
      <DescriptionPanel project={project} seo={seo} description={readyDisplay.description} busy={controlsBusy} onPatch={update} onRegenerate={() => void generate(['description'])} onFlush={() => void flush()} />
      <TagsPanel seo={seo} busy={controlsBusy} onPatch={update} onRegenerate={() => void generate(['tags'])} onFlush={() => void flush()} />
      <PinnedCommentPanel seo={seo} busy={controlsBusy} onPatch={update} onRegenerate={() => void generate(['pinnedComment'])} onFlush={() => void flush()} />
      <ThumbnailPanel seo={seo} thumbnailFile={thumbnailFile} busy={controlsBusy} onPatch={update} onRegenerate={() => void generate(['thumbnail'])} onUpload={(file) => void uploadThumbnail(file)} onRemove={() => void removeThumbnail()} />
    </div>
    <PublishPanel project={{ ...project, seo }} thumbnailFile={thumbnailFile} renderFile={renderFile} channel={channel} onCopy={() => void copyPackage()} onDownload={() => void downloadPackage()} />
    <div className={styles.flush}><Button size="sm" onClick={() => void flush()} disabled={saveState !== 'error'}>Thử lưu lại</Button></div>
    {channelDialog}
  </main>;
}
