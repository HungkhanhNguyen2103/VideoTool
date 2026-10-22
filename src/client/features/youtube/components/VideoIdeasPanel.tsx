import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_MODEL_REGISTRY, getDefaultAiModelId } from '../../../../contracts/ai-models';
import { SCRIPT_PRESET_IDS } from '../../../../contracts/project';
import type { YoutubeIdeaRecord, YoutubeIdeaStatus } from '../../../../contracts/youtube-ideas';
import { ApiError } from '../../../shared/api-client';
import { useJobProgress } from '../../../shared/hooks/use-job-progress';
import { Button } from '../../../shared/ui/Button';
import { cancelJob } from '../../../shared/job-api';
import { addYoutubeGrowthExperiment } from '../api';
import { getYoutubeCliStatus, prepareYoutubeIdeaProject, startYoutubeIdeasGeneration, updateYoutubeIdea } from '../api';
import { youtubeGrowthPlanKey, youtubeGrowthPlanStatusKey, youtubeIdeasKey, useYoutubeGrowthPlanStatus, useYoutubeIdeas } from '../hooks';
import { buildYoutubeIdeaResearchRequest, canChangeYoutubeIdeaStatus, isYoutubeIdeaCoverageStale, mapYoutubeIdeaToProjectPrefill, validateYoutubeIdeaSteering, YOUTUBE_IDEA_MANUAL_CHECK_INSTRUCTIONS, youtubeIdeaGateText, youtubeIdeaTierText } from '../idea-view';
import styles from './VideoIdeasPanel.module.css';

const PRESET_LABELS: Record<(typeof SCRIPT_PRESET_IDS)[number], string> = {
  'documentary': 'Phim tài liệu', 'explainer': 'Giải thích', 'hubris-trap': 'Kẻ đi săn kiêu ngạo', 'strategist': 'Chiến lược',
};
const MOTIF_LABELS = { hunter: 'Người đi săn', perfectPlan: 'Kế hoạch hoàn hảo', blindSpot: 'Điểm mù', selfDestruction: 'Tự hủy' } as const;
const EVIDENCE_LABELS = { strong: 'Khá rõ', partial: 'Một phần', thin: 'Mỏng' } as const;
const RARITY_LABELS = { common: 'phổ biến', uncommon: 'không phổ biến', rare: 'hiếm', unknown: 'chưa rõ' } as const;
const VARIABLE_LABELS = { topic: 'Chủ đề', title: 'Tiêu đề', thumbnail: 'Thumbnail', hook: 'Mở đầu', length: 'Độ dài', cadence: 'Nhịp đăng', other: 'Khác' } as const;
const DATE_TIME = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function MotifTable({ idea }: { idea: YoutubeIdeaRecord['idea'] }) {
  if (!idea.motif) return <p className={styles.muted}>Preset này không yêu cầu bốn mắt xích hubris-trap.</p>;
  return <div className={styles.motifTableWrap}><table className={styles.motifTable}><thead><tr><th>Mắt xích</th><th>Giả thuyết</th><th>Chứng cứ</th></tr></thead><tbody>
    {(Object.keys(MOTIF_LABELS) as (keyof typeof MOTIF_LABELS)[]).map((key) => <tr key={key}><th scope="row">{MOTIF_LABELS[key]}</th><td>{idea.motif![key].text}</td><td><span className={`${styles.evidenceChip} ${styles[idea.motif![key].evidence]}`}>{EVIDENCE_LABELS[idea.motif![key].evidence]}</span></td></tr>)}
  </tbody></table></div>;
}

function IdeaCard({ channelId, language, row, verdictPresent, onRefresh }: { channelId: string; language: 'vi' | 'en'; row: YoutubeIdeaRecord; verdictPresent: boolean; onRefresh: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [manualNote, setManualNote] = useState(row.manualDemand?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: youtubeIdeasKey(channelId) });
    await onRefresh();
  }

  async function setStatus(status: Exclude<YoutubeIdeaStatus, 'used'>) {
    if (!canChangeYoutubeIdeaStatus(row.status, status)) return;
    setBusy(true); setError(null); setNotice(null);
    try { await updateYoutubeIdea(channelId, row.id, { status }); await refresh(); }
    catch (caught) { setError(errorText(caught, 'Không thể cập nhật trạng thái ý tưởng.')); }
    finally { setBusy(false); }
  }

  async function saveManualDemand() {
    const note = manualNote.trim();
    if (!note || note.length > 300) { setError('Ghi một câu, tối đa 300 ký tự.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try { await updateYoutubeIdea(channelId, row.id, { manualDemand: { note } }); setNotice('Đã lưu ghi chú kiểm tra thủ công.'); await refresh(); }
    catch (caught) { setError(errorText(caught, 'Không thể lưu ghi chú kiểm tra.')); }
    finally { setBusy(false); }
  }

  async function copyResearchRequest() {
    try {
      await navigator.clipboard.writeText(buildYoutubeIdeaResearchRequest(row.idea, language));
      setNotice('Đã sao chép yêu cầu research có dẫn nguồn.'); setError(null);
    } catch { setError('Không thể dùng clipboard ở trình duyệt này.'); }
  }

  async function openProjectForm() {
    setBusy(true); setError(null);
    try {
      const response = await prepareYoutubeIdeaProject(channelId, row.id);
      navigate('/production/init', { state: mapYoutubeIdeaToProjectPrefill(response) });
    } catch (caught) { setError(errorText(caught, 'Không thể mở form tạo dự án.')); }
    finally { setBusy(false); }
  }

  async function logExperiment() {
    if (!window.confirm('Ghi tiêu đề ý tưởng này vào nhật ký thử nghiệm của kênh?')) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await addYoutubeGrowthExperiment(channelId, { date: localDate(), variable: row.idea.testVariable, note: row.idea.title, videoIds: [] });
      await queryClient.invalidateQueries({ queryKey: youtubeGrowthPlanKey(channelId) });
      await queryClient.invalidateQueries({ queryKey: youtubeGrowthPlanStatusKey(channelId) });
      setNotice('Đã ghi vào nhật ký thử nghiệm.');
    } catch (caught) { setError(errorText(caught, 'Không thể ghi thử nghiệm.')); }
    finally { setBusy(false); }
  }

  return <article className={styles.ideaCard}>
    <header className={styles.ideaHeading}>
      <div><span className={styles.presetChip}>{PRESET_LABELS[row.idea.presetId]}</span><span className={styles.statusChip}>{row.status === 'new' ? 'Mới' : row.status === 'chosen' ? 'Đã chọn' : row.status === 'rejected' ? 'Đã loại' : 'Đã dùng'}</span><h4>{row.idea.title}</h4></div>
      <p className={styles.hook}><strong>Mở đầu:</strong> {row.idea.hook}</p>
    </header>
    <details className={styles.brief}><summary>Xem brief</summary><p>{row.idea.brief}</p></details>
    <MotifTable idea={row.idea} />
    <p className={styles.why}><strong>Vì sao hợp kênh:</strong> {row.idea.whyForThisChannel}</p>
    <div className={styles.testRow}><span className={styles.variableChip}>Thử biến: {VARIABLE_LABELS[row.idea.testVariable]}</span><p><strong>Tiêu chí:</strong> {row.idea.successCriterion.description} · sau {row.idea.successCriterion.afterVideos} video</p></div>
    <div className={styles.scores} aria-label="Điểm phản biện"><span>Độ hợp {row.idea.scores.fit}/5</span><span>Độ rõ {row.idea.scores.clarity}/5</span><span>Rủi ro nguồn mỏng {row.idea.scores.riskOfThinSources}/5</span></div>
    {row.idea.unverifiedFacts.length > 0 && <section className={styles.unverified}><strong>Cần kiểm chứng <span>Từ trí nhớ của AI, chưa có nguồn</span></strong><ul>{row.idea.unverifiedFacts.map((fact, index) => <li key={`${index}-${fact}`}>{fact}</li>)}</ul></section>}
    {row.idea.rarityGuess && <p className={styles.rarity}>Ước đoán độ hiếm: {RARITY_LABELS[row.idea.rarityGuess]} · chưa được kiểm chứng</p>}
    <section className={styles.manualCheck}>
      <label htmlFor={`manual-demand-${row.id}`}>Kiểm tra nhu cầu thủ công · khoảng 5 phút</label>
      <p>{YOUTUBE_IDEA_MANUAL_CHECK_INSTRUCTIONS}</p>
      <div className={styles.manualRow}><textarea id={`manual-demand-${row.id}`} maxLength={300} rows={2} value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="Ghi một câu bạn quan sát được; ghi chú này không được dùng làm số liệu." /><Button size="sm" onClick={() => void saveManualDemand()} disabled={busy || !manualNote.trim()}>Lưu ghi chú</Button></div>
      {row.manualDemand && <small>Đã ghi {DATE_TIME.format(new Date(row.manualDemand.checkedAt))}: {row.manualDemand.note}</small>}
    </section>
    {row.usedProjectId && <p className={styles.usedLink}>Đã dùng trong <a href={`/production/${encodeURIComponent(row.usedProjectId)}/review`}>dự án {row.usedProjectId}</a></p>}
    <div className={styles.cardActions}>
      {row.status === 'new' && <><Button size="sm" variant="amber" disabled={busy} onClick={() => void setStatus('chosen')}>Chọn</Button><Button size="sm" variant="red" disabled={busy} onClick={() => void setStatus('rejected')}>Loại bỏ</Button></>}
      {row.status === 'chosen' && <><Button size="sm" disabled={busy} onClick={() => void setStatus('new')}>Bỏ chọn</Button><Button size="sm" variant="red" disabled={busy} onClick={() => void setStatus('rejected')}>Loại bỏ</Button></>}
      {row.status === 'rejected' && <Button size="sm" disabled={busy} onClick={() => void setStatus('new')}>Khôi phục</Button>}
      {row.status !== 'used' && row.status !== 'rejected' && <Button size="sm" variant="amber" disabled={busy} onClick={() => void openProjectForm()}>Tạo dự án từ ý tưởng</Button>}
      {row.status !== 'rejected' && row.status !== 'used' && <Button size="sm" disabled={busy} onClick={() => void copyResearchRequest()}>Sao chép yêu cầu research</Button>}
      {verdictPresent && row.status !== 'rejected' && row.status !== 'used' && <Button size="sm" disabled={busy} onClick={() => void logExperiment()}>Ghi vào nhật ký thử nghiệm</Button>}
    </div>
    {notice && <p className={styles.notice} role="status">{notice}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
  </article>;
}

export function VideoIdeasPanel({ channelId, language = 'vi' }: { channelId: string; language?: 'vi' | 'en' }) {
  const queryClient = useQueryClient();
  const ideasQuery = useYoutubeIdeas(channelId);
  const planQuery = useYoutubeGrowthPlanStatus(channelId);
  const [backend, setBackend] = useState<'cli' | 'api'>('cli');
  const [cliModel, setCliModel] = useState<string>(getDefaultAiModelId('claude'));
  const [steering, setSteering] = useState('');
  const [presetId, setPresetId] = useState<(typeof SCRIPT_PRESET_IDS)[number]>('hubris-trap');
  const [count, setCount] = useState(6);
  const [duration, setDuration] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(true);
  const progress = useJobProgress(jobId);
  const cliStatusQuery = useQuery({ queryKey: ['script', 'claude-cli-status'], queryFn: getYoutubeCliStatus, enabled: backend === 'cli', staleTime: 15_000, retry: false });
  const active = Boolean(jobId && (!progress || ['queued', 'running'].includes(progress.status)));
  const cliUnavailable = backend === 'cli' && !cliStatusQuery.isLoading && (cliStatusQuery.error || cliStatusQuery.data?.available !== true);
  const ideas = ideasQuery.data?.ideas ?? [];
  const accepted = ideas.filter((row) => row.status !== 'rejected');
  const rejected = ideas.filter((row) => row.status === 'rejected');
  const planVerdict = planQuery.data?.verdict;
  const needsStopBanner = planVerdict?.verdict === 'consider_stop';

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (progress?.status !== 'done') return;
    void queryClient.invalidateQueries({ queryKey: youtubeIdeasKey(channelId) });
    void queryClient.invalidateQueries({ queryKey: youtubeGrowthPlanStatusKey(channelId) });
  }, [channelId, progress?.status, queryClient]);

  async function generate() {
    const steeringError = validateYoutubeIdeaSteering(steering);
    if (steeringError) { setError(steeringError); return; }
    const targetDurationSec = duration.trim() ? Number(duration) : undefined;
    if (targetDurationSec !== undefined && (!Number.isInteger(targetDurationSec) || targetDurationSec < 30 || targetDurationSec > 3600)) { setError('Thời lượng phải từ 30 đến 3.600 giây.'); return; }
    setStarting(true); setError(null);
    try {
      const result = await startYoutubeIdeasGeneration(channelId, {
        backend,
        ...(backend === 'cli' ? { cliModel } : {}),
        steering,
        presetId,
        count,
        ...(targetDurationSec !== undefined ? { targetDurationSec } : {}),
      });
      setJobId(result.jobId); setStartedAt(Date.now());
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'YOUTUBE_IDEAS_ALREADY_RUNNING' && caught.jobId) {
        setJobId(caught.jobId); setStartedAt(Date.now());
      } else setError(errorText(caught, 'Không thể bắt đầu gợi ý video.'));
    } finally { setStarting(false); }
  }

  async function cancel() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try { await cancelJob(jobId); }
    catch (caught) { setError(errorText(caught, 'Không thể gửi yêu cầu hủy.')); }
    finally { setCancelling(false); }
  }

  const elapsed = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1_000));
  const run = ideasQuery.data?.latestRun;
  const stale = isYoutubeIdeaCoverageStale(run ?? null, ideasQuery.data?.currentCoverageFingerprint ?? '');

  return <section className={styles.panel} aria-labelledby="video-ideas-heading">
    <header className={styles.header}><div><p className={styles.eyebrow}>YOUTUBE · ƯỚC LƯỢNG THEO CHỨNG CỨ</p><h2 id="video-ideas-heading">Ý tưởng video tiếp theo</h2><p>Claude CLI không có web hoặc tệp. Dữ kiện lịch sử là chưa kiểm chứng; không có dữ liệu nhu cầu tìm kiếm hay dự báo lượt xem.</p></div><span className={styles.tierChip}>{ideasQuery.data?.currentTier ? youtubeIdeaTierText(ideasQuery.data.currentTier, ideasQuery.data.matureVideoCount) : 'Đang xác định mức chứng cứ'}</span></header>
    {ideasQuery.data && <p className={styles.gate}>{ideasQuery.data.matureVideoCount} video trưởng thành · {youtubeIdeaGateText(ideasQuery.data.matureVideoCount, ideasQuery.data.minimumMatureForDataInformed)}</p>}
    {needsStopBanner && <aside className={styles.stopBanner}><strong>Kế hoạch tăng trưởng đang cân nhắc dừng.</strong><p>{planVerdict.reasons.map((row) => row.text).join(' ')}</p><small>Ý tưởng vẫn là lựa chọn sáng tạo chưa kiểm chứng; chúng không bác bỏ kết luận kế hoạch.</small></aside>}
    {stale && <aside className={styles.stale} role="status">Danh sách dự án hoặc video đã đổi sau lượt gợi ý gần nhất. Hãy tạo lượt mới để cập nhật coverage map.</aside>}

    <div className={styles.controls}>
      <label className={styles.steering}>Chỉ dẫn thêm<textarea value={steering} maxLength={500} rows={3} onChange={(event) => setSteering(event.target.value)} placeholder="Ví dụ: lịch sử Việt Nam; tránh thời kỳ hoặc nhân vật đã làm; chọn một câu chuyện có đủ nguồn để research." /><small>{steering.length}/500 ký tự · văn bản này là dữ liệu, không phải lệnh hệ thống.</small></label>
      <label>Preset<select value={presetId} onChange={(event) => setPresetId(event.target.value as (typeof SCRIPT_PRESET_IDS)[number])}>{SCRIPT_PRESET_IDS.map((id) => <option value={id} key={id}>{PRESET_LABELS[id]}</option>)}</select></label>
      <label>Số ý tưởng<select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[4, 5, 6, 7, 8].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>Thời lượng · giây<input type="number" min={30} max={3600} value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Dự án gần nhất hoặc 600" /><small>Bỏ trống để dùng thời lượng dự án gần nhất hoặc 600 giây.</small></label>
      <label>Backend<select value={backend} disabled={active} onChange={(event) => setBackend(event.target.value as 'cli' | 'api')}><option value="cli">Claude CLI</option><option value="api">API</option></select></label>
      {backend === 'cli' && <label>Model Claude<select value={cliModel} disabled={active} onChange={(event) => setCliModel(event.target.value)}>{AI_MODEL_REGISTRY.claude.models.map((model) => <option value={model.id} key={model.id}>{model.label} · {model.hint}</option>)}</select></label>}
      <Button variant="amber" onClick={() => void generate()} disabled={starting || active || Boolean(cliUnavailable) || (backend === 'cli' && cliStatusQuery.isLoading)}>{starting ? 'Đang xếp hàng…' : active ? 'Đang gợi ý…' : 'Gợi ý video tiếp theo'}</Button>
    </div>
    {backend === 'cli' && <p className={cliUnavailable ? styles.error : styles.muted} role={cliUnavailable ? 'alert' : undefined}>{cliStatusQuery.isLoading ? 'Đang kiểm tra Claude Code CLI…' : cliUnavailable ? (cliStatusQuery.data?.reason ?? 'Không kiểm tra được trạng thái Claude Code CLI.') : `Claude Code CLI sẵn sàng${cliStatusQuery.data?.version ? ` · ${cliStatusQuery.data.version}` : ''}.`}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {ideasQuery.isLoading && <p className={styles.state} role="status">Đang tải ý tưởng đã lưu…</p>}
    {ideasQuery.error && <div className={styles.stateError} role="alert"><span>{errorText(ideasQuery.error, 'Không tải được ý tưởng.')}</span><Button size="sm" onClick={() => void ideasQuery.refetch()}>Thử lại</Button></div>}

    {jobId && <section className={styles.progress} aria-label="Tiến độ gợi ý video">
      <div className={styles.progressTop}><strong>{progress?.logs.slice().reverse().find((line) => line.startsWith('Bước '))?.split(':')[0] ?? (progress?.status === 'done' ? 'Hoàn tất' : 'Đang chờ worker…')}</strong><span>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span></div>
      <progress max={100} value={progress?.progress ?? 0} aria-label="Phần trăm hoàn thành" />
      {progress?.status === 'failed' && <p className={styles.error} role="alert">{progress.error ?? 'Gợi ý video thất bại.'} <button type="button" className={styles.inlineButton} onClick={() => void generate()}>Thử lại</button></p>}
      {progress?.status === 'cancelled' && <p className={styles.muted} role="status">Đã hủy; các ý tưởng của lượt chạy này chưa được lưu.</p>}
      <div className={styles.logActions}><button type="button" className={styles.linkButton} aria-expanded={logsOpen} onClick={() => setLogsOpen((open) => !open)}>{logsOpen ? 'Ẩn log' : 'Xem log'}</button>{active ? <Button size="sm" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? 'Đang gửi…' : 'Hủy'}</Button> : <Button size="sm" onClick={() => { setJobId(null); setStartedAt(null); }}>Đóng</Button>}</div>
      {logsOpen && <ol className={styles.logs} role="log" aria-live="polite">{(progress?.logs ?? []).slice(-30).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>}
    </section>}

    {run && <section className={styles.runSummary}><div><strong>Lượt gần nhất</strong><span>{run.backend === 'cli' ? 'Claude CLI' : 'API'} · {run.model} · {DATE_TIME.format(new Date(run.generatedAt))}</span></div><span>{run.dropped.length} mục bị bỏ sau đối chiếu · bậc {run.evidenceTier}</span>{run.dropped.length > 0 && <details><summary>Xem lý do các mục bị bỏ</summary><ul>{run.dropped.map((item, index) => <li key={`${index}-${item.id}`}><strong>{item.id}:</strong> {item.reason}</li>)}</ul></details>}</section>}
    {!ideasQuery.isLoading && !ideasQuery.error && accepted.length === 0 && <p className={styles.state}>Chưa có ý tưởng. Bấm Gợi ý video tiếp theo.</p>}
    {accepted.length > 0 && <div className={styles.ideaList}>{accepted.map((row) => <IdeaCard channelId={channelId} language={language} key={row.id} row={row} verdictPresent={Boolean(planVerdict)} onRefresh={() => queryClient.invalidateQueries({ queryKey: youtubeIdeasKey(channelId) })} />)}</div>}
    {rejected.length > 0 && <details className={styles.rejected}><summary>Ý tưởng đã loại bỏ ({rejected.length})</summary><div className={styles.ideaList}>{rejected.map((row) => <IdeaCard channelId={channelId} language={language} key={row.id} row={row} verdictPresent={Boolean(planVerdict)} onRefresh={() => queryClient.invalidateQueries({ queryKey: youtubeIdeasKey(channelId) })} />)}</div></details>}
  </section>;
}
