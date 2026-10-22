import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { YoutubeGrowthExperimentInputSchema, YoutubeGrowthPlanConfigSchema, type YoutubeGrowthPlan, type YoutubeGrowthPlanConfig, type YoutubeGrowthPlanStatus } from '../../../../contracts/youtube-plan';
import { Button } from '../../../shared/ui/Button';
import { addYoutubeGrowthExperiment, deleteYoutubeGrowthExperiment, getYoutubeGrowthPlan, saveYoutubeGrowthPlan } from '../api';
import { useYoutubeGrowthPlan, useYoutubeGrowthPlanStatus, useYoutubeVideos, youtubeChannelsOverviewKey, youtubeGrowthPlanKey, youtubeGrowthPlanStatusKey, youtubeOverviewKey } from '../hooks';
import { checkpointStatusLabel, formatGrowthDate, formatGrowthInterval, formatGrowthNumber, growthProgress, growthStageLabel, growthVerdictLabel } from '../growth-plan-view';
import styles from './GrowthPlanPanel.module.css';

const STAGES = ['A', 'B', 'C', 'D', 'E'] as const;
const EXPERIMENT_VARIABLES = ['topic', 'title', 'thumbnail', 'hook', 'length', 'cadence', 'other'] as const;
const VARIABLE_LABELS: Record<(typeof EXPERIMENT_VARIABLES)[number], string> = { topic: 'Chủ đề', title: 'Tiêu đề', thumbnail: 'Thumbnail', hook: 'Mở đầu', length: 'Độ dài', cadence: 'Nhịp đăng', other: 'Khác' };
const THRESHOLD_NOTE = 'mốc tham khảo, kiểm tra lại trên YouTube Studio';
const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function planConfig(plan: YoutubeGrowthPlan): YoutubeGrowthPlanConfig {
  return {
    nicheStartDate: plan.nicheStartDate,
    cadencePerWeek: plan.cadencePerWeek,
    viewTargets: plan.viewTargets,
    assumedAvgViewDurationMin: plan.assumedAvgViewDurationMin,
    toleranceMonths: plan.toleranceMonths,
    warnAtMatureVideos: plan.warnAtMatureVideos,
    decideAtMatureVideos: plan.decideAtMatureVideos,
    decideMinMonths: plan.decideMinMonths,
    hardReviewWeek: plan.hardReviewWeek,
    minExperimentsBeforeStop: plan.minExperimentsBeforeStop,
    submittedForReviewAt: plan.submittedForReviewAt,
  };
}

function Progress({ label, value, actual, target }: { label: string; value: number | null; actual: number | null; target: number }) {
  const progress = growthProgress(actual, target);
  return <div className={styles.progressRow}>
    <div><span>{label}</span><small>{formatGrowthNumber(actual, 0)} / {formatGrowthNumber(target, 0)}</small></div>
    {progress === null ? <span className={styles.muted}>Chưa có dữ liệu</span> : <div className={styles.progressTrack} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
    <strong>{value === null ? '—' : `${Math.round(value * 100)}%`}</strong>
  </div>;
}

function ThresholdProgress({ status, period, label }: { status: YoutubeGrowthPlanStatus; period: 'current' | 'from2027_02_01'; label: string }) {
  const tier = status.thresholds[period].ads;
  const subscribers = status.metrics.subscribers_current?.value ?? null;
  const hours = status.metrics.public_long_watch_hours_365d?.value ?? null;
  return <section className={styles.thresholdPeriod}>
    <h4>{label}</h4>
    <Progress label="Người đăng ký" value={growthProgress(subscribers, tier.subscribers)} actual={subscribers} target={tier.subscribers} />
    <Progress label="Giờ xem video dài công khai · 365 ngày" value={growthProgress(hours, tier.longWatchHours)} actual={hours} target={tier.longWatchHours} />
    <small>{formatGrowthNumber(tier.shortViews, 0)} lượt xem Shorts · không cộng giờ xem</small>
  </section>;
}

function Field({ label, value, type = 'number', min, max, step, onChange }: { label: string; value: string | number; type?: 'date' | 'number'; min?: number; max?: number; step?: number; onChange: (value: string) => void }) {
  return <label className={styles.field}>{label}<input type={type} value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} /></label>;
}

function useInvalidateGrowthPlan(channelId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: youtubeGrowthPlanKey(channelId) }),
      queryClient.invalidateQueries({ queryKey: youtubeGrowthPlanStatusKey(channelId) }),
      queryClient.invalidateQueries({ queryKey: youtubeOverviewKey(channelId) }),
      queryClient.invalidateQueries({ queryKey: youtubeChannelsOverviewKey }),
      queryClient.invalidateQueries({ queryKey: ['youtube', 'videos', channelId] }),
    ]);
  };
}

function PlanSettings({ channelId, plan, loading }: { channelId: string; plan: YoutubeGrowthPlan; loading: boolean }) {
  const invalidate = useInvalidateGrowthPlan(channelId);
  const [form, setForm] = useState<YoutubeGrowthPlanConfig>(() => YoutubeGrowthPlanConfigSchema.parse({}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setForm(YoutubeGrowthPlanConfigSchema.parse(planConfig(plan))); }, [plan.channelProfileId, plan.updatedAt]);

  async function save() {
    setError(null); setMessage(null);
    const parsed = YoutubeGrowthPlanConfigSchema.safeParse(form);
    if (!parsed.success) { setError('Cấu hình kế hoạch chưa hợp lệ. Kiểm tra ngày và các giá trị trong giới hạn cho phép.'); return; }
    setBusy(true);
    try {
      await saveYoutubeGrowthPlan(channelId, parsed.data);
      setMessage('Đã lưu kế hoạch kênh.');
      await invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể lưu kế hoạch kênh.');
    } finally { setBusy(false); }
  }

  const number = (key: keyof YoutubeGrowthPlanConfig, raw: string) => setForm((current) => ({ ...current, [key]: raw === '' ? 0 : Number(raw) }));
  return <details className={styles.settings}>
    <summary>Cấu hình kế hoạch {loading && <span className={styles.muted}>· đang tải</span>}</summary>
    <div className={styles.formGrid}>
      <Field label="Ngày bắt đầu ngách" type="date" value={form.nicheStartDate ?? ''} onChange={(value) => setForm((current) => ({ ...current, nicheStartDate: value || null }))} />
      <Field label="Nhịp đăng · video/tuần" value={form.cadencePerWeek} min={0.5} max={14} step={0.5} onChange={(value) => number('cadencePerWeek', value)} />
      <Field label="Mốc view đầu · 28 ngày" value={form.viewTargets.first} min={1} onChange={(value) => setForm((current) => ({ ...current, viewTargets: { ...current.viewTargets, first: Number(value) } }))} />
      <Field label="Mốc view mạnh · 28 ngày" value={form.viewTargets.strong} min={1} onChange={(value) => setForm((current) => ({ ...current, viewTargets: { ...current.viewTargets, strong: Number(value) } }))} />
      <Field label="Giới hạn chờ · tháng" value={form.toleranceMonths} min={1} max={60} onChange={(value) => number('toleranceMonths', value)} />
      <Field label="Thời lượng xem TB · giả định, phút" value={form.assumedAvgViewDurationMin} min={0.1} max={720} step={0.1} onChange={(value) => number('assumedAvgViewDurationMin', value)} />
      <Field label="Cảnh báo · video trưởng thành" value={form.warnAtMatureVideos} min={1} onChange={(value) => number('warnAtMatureVideos', value)} />
      <Field label="Quyết định · video trưởng thành" value={form.decideAtMatureVideos} min={1} onChange={(value) => number('decideAtMatureVideos', value)} />
      <Field label="Quyết định sớm nhất · tháng" value={form.decideMinMonths} min={1} onChange={(value) => number('decideMinMonths', value)} />
      <Field label="Rà soát bắt buộc · tuần" value={form.hardReviewWeek} min={1} onChange={(value) => number('hardReviewWeek', value)} />
      <Field label="Số thử nghiệm trước khi dừng" value={form.minExperimentsBeforeStop} min={0} onChange={(value) => number('minExperimentsBeforeStop', value)} />
      <Field label="Ngày tự đánh dấu đã nộp YPP" type="date" value={form.submittedForReviewAt ?? ''} onChange={(value) => setForm((current) => ({ ...current, submittedForReviewAt: value || null }))} />
    </div>
    <p className={styles.muted}>Mọi mặc định và ngưỡng tự đặt chỉ là gợi ý của người dùng/Claude, chưa kiểm chứng. Số dùng giả định luôn được gắn nhãn.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success} role="status">{message}</p>}
    <Button size="sm" variant="amber" onClick={() => void save()} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu kế hoạch'}</Button>
  </details>;
}

function MetricRegistry({ status }: { status: YoutubeGrowthPlanStatus }) {
  return <details className={styles.registry}>
    <summary>Danh mục số liệu để đối chiếu</summary>
    <div className={styles.registryList}>{Object.entries(status.metrics).map(([id, item]) => <article id={`registry-${id}`} key={id}>
      <a href={`#registry-${id}`}><strong>{item.label}</strong></a><span>{formatGrowthNumber(item.value)} {item.unit}{item.assumed ? ' · giả định/xấp xỉ' : ''}</span><code>{id}</code>
    </article>)}</div>
  </details>;
}

function GrowthPlanContent({ channelId, status }: { channelId: string; status: YoutubeGrowthPlanStatus }) {
  const invalidate = useInvalidateGrowthPlan(channelId);
  const videosQuery = useYoutubeVideos(channelId, { type: 'long', sort: 'publishedAt', window: 'lifetime' }, true);
  const planQuery = useYoutubeGrowthPlan(channelId);
  const [experimentDate, setExperimentDate] = useState(today);
  const [variable, setVariable] = useState<(typeof EXPERIMENT_VARIABLES)[number]>('topic');
  const [note, setNote] = useState('');
  const [videoIds, setVideoIds] = useState('');
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [experimentError, setExperimentError] = useState<string | null>(null);
  const [experimentMessage, setExperimentMessage] = useState<string | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const queryClient = useQueryClient();

  async function addExperiment() {
    setExperimentError(null); setExperimentMessage(null);
    const parsed = YoutubeGrowthExperimentInputSchema.safeParse({ date: experimentDate, variable, note, ...(videoIds.trim() ? { videoIds: videoIds.split(',').map((id) => id.trim()).filter(Boolean) } : {}) });
    if (!parsed.success) { setExperimentError('Thông tin thử nghiệm không hợp lệ. Kiểm tra ngày, ghi chú tối đa 300 ký tự và danh sách video.'); return; }
    setExperimentBusy(true);
    try {
      const saved = await addYoutubeGrowthExperiment(channelId, parsed.data);
      queryClient.setQueryData(youtubeGrowthPlanKey(channelId), saved);
      setNote(''); setVideoIds(''); setExperimentMessage('Đã ghi thử nghiệm.');
      await invalidate();
    } catch (caught) { setExperimentError(caught instanceof Error ? caught.message : 'Không thể ghi thử nghiệm.'); }
    finally { setExperimentBusy(false); }
  }

  async function deleteExperiment(id: string) {
    setExperimentError(null);
    try {
      const saved = await deleteYoutubeGrowthExperiment(channelId, id);
      queryClient.setQueryData(youtubeGrowthPlanKey(channelId), saved);
      await invalidate();
    } catch (caught) { setExperimentError(caught instanceof Error ? caught.message : 'Không thể xóa thử nghiệm.'); }
  }

  async function markSubmitted() {
    setSubmitPending(true);
    try {
      const current = await getYoutubeGrowthPlan(channelId);
      await saveYoutubeGrowthPlan(channelId, { ...planConfig(current), submittedForReviewAt: today() });
      await invalidate();
    } catch (caught) { setExperimentError(caught instanceof Error ? caught.message : 'Không thể lưu ngày tự đánh dấu.'); }
    finally { setSubmitPending(false); }
  }

  const videosById = new Map((videosQuery.data ?? []).map((video) => [video.videoId, video]));
  const planVideoRows = status.videos;
  const citationIds = [...new Set(status.verdict.reasons.flatMap((reason) => reason.metricIds))].filter((id) => status.metrics[id]);
  const firstHitRate = status.hitRates.first;
  const strongHitRate = status.hitRates.strong;
  const showNichePrompt = !status.plan.nicheStartDate;

  return <>
    {showNichePrompt && <aside className={styles.nichePrompt}><strong>Đặt ngày bắt đầu ngách</strong><span>Ngày này xác định video nào thuộc kế hoạch; video cũ không được tự thêm vào.</span></aside>}
    <PlanSettings channelId={channelId} plan={planQuery.data ?? status.plan} loading={planQuery.isLoading} />

    <div className={styles.stageSection}>
      <div className={styles.sectionTitle}><div><h3>Giai đoạn hiện tại</h3><p>{status.stage.label}</p></div><span className={styles.stageBadge}>Giai đoạn {status.stage.current}</span></div>
      <ol className={styles.stageLadder}>{STAGES.map((stage) => <li key={stage} className={stage === status.stage.current ? styles.currentStage : ''}><strong>{stage}</strong><span>{growthStageLabel(stage)}</span></li>)}</ol>
      {status.stage.next && <div className={styles.unmet}><strong>Điều kiện còn thiếu cho giai đoạn {status.stage.next}</strong>{status.stage.unmetConditions.length ? <ul>{status.stage.unmetConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul> : <p>Đã đủ điều kiện; số liệu sẽ chuyển giai đoạn khi đồng bộ tiếp theo.</p>}</div>}
    </div>

    <section className={styles.progressSection} aria-labelledby="growth-progress-title">
      <div className={styles.sectionTitle}><div><h3 id="growth-progress-title">Tiến độ theo mốc YPP</h3><p>{THRESHOLD_NOTE} · mốc giờ xem chỉ tính video dài công khai.</p></div><span className={styles.checked}>Kiểm tra {status.thresholds.checkedOn}</span></div>
      <div className={styles.thresholdGrid}><ThresholdProgress status={status} period="current" label={`Hiện tại · ${formatGrowthNumber(status.thresholds.current.ads.longWatchHours, 0)} giờ`} /><ThresholdProgress status={status} period="from2027_02_01" label={`Từ 01/02/2027 · ${formatGrowthNumber(status.thresholds.from2027_02_01.ads.longWatchHours, 0)} giờ`} /></div>
      <div className={styles.thresholdSources}>Nguồn chính thức: {status.thresholds.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer noopener">{index > 0 ? ' · ' : ''}YouTube {index + 1}</a>)}</div>
      <div className={styles.forecastRange}>
        <strong>Ngày dự kiến đạt đủ số liệu</strong>
        {status.forecast.status === 'insufficient-data' ? <span>{status.forecast.reason}</span> : <span>{status.forecast.optimistic.date && status.forecast.pessimistic.date ? `${formatGrowthDate(status.forecast.optimistic.date)} – ${formatGrowthDate(status.forecast.pessimistic.date)}` : 'Chưa chạm mốc trong thời hạn dự báo'}</span>}
      </div>
      <div className={styles.submitted}><span>Đã nộp xét duyệt YPP (tự đánh dấu)</span><strong>{formatGrowthDate(status.submittedForReviewAt)}</strong>{!status.submittedForReviewAt && <Button size="sm" onClick={() => void markSubmitted()} disabled={submitPending}>{submitPending ? 'Đang lưu…' : 'Đánh dấu hôm nay'}</Button>}</div>
    </section>

    <section className={styles.viewsSection} aria-labelledby="growth-views-title">
      <div className={styles.sectionTitle}><div><h3 id="growth-views-title">Mốc view 28 ngày đầu</h3><p>{status.matureCount} video trưởng thành · {status.pending.length} đang chờ đo · {status.distribution.unknownMatureCount} chưa có số liệu.</p></div></div>
      <div className={styles.hitGrid}>
        <article><strong>{formatGrowthInterval(firstHitRate, status.plan.viewTargets.first)}</strong><span>{firstHitRate.hits}/{firstHitRate.count} đạt {formatGrowthNumber(status.plan.viewTargets.first, 0)} lượt xem{firstHitRate.approximate ? ' · có số liệu xấp xỉ' : ''}</span></article>
        <article><strong>{formatGrowthInterval(strongHitRate, status.plan.viewTargets.strong)}</strong><span>{strongHitRate.hits}/{strongHitRate.count} đạt {formatGrowthNumber(status.plan.viewTargets.strong, 0)} lượt xem{strongHitRate.approximate ? ' · có số liệu xấp xỉ' : ''}</span></article>
      </div>
      {videosQuery.isLoading ? <p className={styles.muted} role="status">Đang tải chi tiết các video…</p> : videosQuery.error ? <p className={styles.error} role="alert">Không tải được danh sách video để ghép tiêu đề.</p> : planVideoRows.length === 0 ? <p className={styles.muted}>Chưa có video thuộc kế hoạch này. Kênh mới chưa có video nào đủ điều kiện là trạng thái bình thường.</p> : <div className={styles.tableScroll}><table><thead><tr><th>Video</th><th>Đăng</th><th>View 28 ngày đầu</th><th>Mốc {formatGrowthNumber(status.plan.viewTargets.first, 0)}</th><th>Mốc {formatGrowthNumber(status.plan.viewTargets.strong, 0)}</th></tr></thead><tbody>
        {planVideoRows.map((row) => <tr key={row.videoId}><td><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(row.videoId)}`} target="_blank" rel="noreferrer noopener">{videosById.get(row.videoId)?.title ?? row.title}</a></td><td>{formatGrowthDate(row.publishedAt)}</td><td>{row.first28dViews === null ? 'Chưa đo được' : <>{formatGrowthNumber(row.first28dViews, 0)}{row.approximate && <small className={styles.assumption}> · xấp xỉ</small>}</>}</td><td>{row.first28dViews === null ? '—' : row.first28dViews >= status.plan.viewTargets.first ? 'Đạt' : 'Chưa đạt'}</td><td>{row.first28dViews === null ? '—' : row.first28dViews >= status.plan.viewTargets.strong ? 'Đạt' : 'Chưa đạt'}</td></tr>)}
      </tbody></table></div>}
      {status.pending.length > 0 && <div className={styles.pendingList}><strong>Video chờ đủ tuổi đo</strong><ul>{status.pending.map((video) => <li key={video.videoId}>{video.title} · dự kiến {formatGrowthDate(video.maturesOn)}</li>)}</ul></div>}
      <div className={styles.requiredViews}><strong>Lượt xem cần trung bình mỗi video: {formatGrowthNumber(status.requiredViews.bindingViewsPerVideo, 0)}</strong><span>Ràng buộc: {status.requiredViews.binding === 'watch-hours' ? 'giờ xem' : status.requiredViews.binding === 'subscribers' ? 'người đăng ký' : status.requiredViews.binding === 'both' ? 'cả hai điều kiện' : 'chưa đo được tỷ lệ đăng ký'}</span><span>Trung vị {formatGrowthNumber(status.distribution.median, 0)} · P75 {formatGrowthNumber(status.distribution.p75, 0)}</span><span className={styles.assumption}>{status.requiredViews.avgViewDurationAssumed ? `Giả định: thời lượng xem TB ${NUMBER.format(status.requiredViews.avgViewDurationMin)} phút.` : 'Thời lượng xem TB đo từ các snapshot 28 ngày.'}</span></div>
    </section>

    <section className={styles.verdictSection} aria-labelledby="growth-verdict-title">
      <div className={styles.sectionTitle}><div><h3 id="growth-verdict-title">Kết luận hiện tại</h3><p>Độ tin cậy: {status.verdict.confidence === 'low' ? 'thấp' : status.verdict.confidence === 'medium' ? 'trung bình' : 'cao'}</p></div><span className={`${styles.verdictBadge} ${status.verdict.verdict === 'consider_stop' || status.verdict.verdict === 'change_one_variable' ? styles.warningBadge : ''}`}>{growthVerdictLabel(status.verdict.verdict)}</span></div>
      {status.verdict.reasons.length ? <ul className={styles.reasons}>{status.verdict.reasons.map((reason, index) => <li key={`${index}-${reason.text}`}>{reason.text}{reason.metricIds.length > 0 && <small>Chỉ số: {reason.metricIds.map((id) => status.metrics[id] ? <a key={id} href={`#${id}`}>{status.metrics[id]!.label}</a> : <code key={id}>{id}</code>)}</small>}</li>)}</ul> : <p className={styles.muted}>Chưa có căn cứ để đưa ra kết luận.</p>}
      {citationIds.length > 0 && <div className={styles.citedMetrics} aria-label="Các chỉ số trong kết luận">{citationIds.map((id) => { const item = status.metrics[id]!; return <article id={id} key={id}><strong>{item.label}</strong><span>{formatGrowthNumber(item.value)} {item.unit}{item.assumed ? ' · giả định/xấp xỉ' : ''}</span></article>; })}</div>}
      {status.verdict.unknowns.length > 0 && <div className={styles.unknowns}><strong>Điểm chưa biết</strong><ul>{status.verdict.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}</ul></div>}
      <p className={styles.nextCheckpoint}><strong>Mốc kiểm tra tiếp theo:</strong> {status.verdict.nextCheckpoint ? (() => { const checkpoint = status.checkpoints.find((item) => item.id === status.verdict.nextCheckpoint); return checkpoint ? `${checkpoint.label} · ${formatGrowthDate(checkpoint.estimatedDate)}` : 'Chưa đặt lịch'; })() : 'Không còn mốc đã đặt.'}</p>
      {status.verdict.forecastReviewText && <p className={styles.warningNote}>{status.verdict.forecastReviewText}</p>}
      <details className={styles.assumptions}><summary>Giả định và giới hạn</summary><ul>{status.assumptions.map((assumption) => <li key={assumption}>{assumption.startsWith('Dự báo từ ít video') ? <strong>{assumption}</strong> : assumption}</li>)}</ul></details>
      <MetricRegistry status={status} />
    </section>

    <section className={styles.checkpointsSection} aria-labelledby="growth-checkpoints-title">
      <div className={styles.sectionTitle}><div><h3 id="growth-checkpoints-title">Các mốc kiểm tra</h3><p>Ngày là ước tính từ nhịp đăng và thời gian trưởng thành 31 ngày.</p></div></div>
      <ol className={styles.checkpoints}>{status.checkpoints.map((checkpoint) => <li key={checkpoint.id} className={checkpoint.status === 'reached' ? styles.reached : ''}><span className={styles.timelineDot} /><div><div className={styles.checkpointHeading}><strong>{checkpoint.label}</strong><span>{checkpointStatusLabel(checkpoint.status)}</span></div><time>{formatGrowthDate(checkpoint.estimatedDate)}</time><small>{checkpoint.matureVideoTarget ? `${checkpoint.matureVideoTarget} video trưởng thành · ` : ''}{checkpoint.evaluate}</small></div></li>)}</ol>
    </section>

    <section className={styles.experimentsSection} aria-labelledby="growth-experiments-title">
      <div className={styles.sectionTitle}><div><h3 id="growth-experiments-title">Nhật ký thử nghiệm</h3><p>{status.plan.experiments.length}/100 lần thử · ghi biến đã đổi để quyết định có căn cứ.</p></div></div>
      {experimentError && <p className={styles.error} role="alert">{experimentError}</p>}{experimentMessage && <p className={styles.success} role="status">{experimentMessage}</p>}
      <div className={styles.experimentForm}>
        <Field label="Ngày" type="date" value={experimentDate} onChange={setExperimentDate} />
        <label className={styles.field}>Biến đã đổi<select value={variable} onChange={(event) => setVariable(event.target.value as (typeof EXPERIMENT_VARIABLES)[number])}>{EXPERIMENT_VARIABLES.map((item) => <option value={item} key={item}>{VARIABLE_LABELS[item]}</option>)}</select></label>
        <label className={styles.field}>Ghi chú<textarea maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Điều đã đổi và kết quả quan sát" /></label>
        <label className={styles.field}>Video liên quan · ID, phân cách bằng dấu phẩy<input value={videoIds} onChange={(event) => setVideoIds(event.target.value)} placeholder="Tùy chọn" /></label>
        <Button size="sm" variant="amber" onClick={() => void addExperiment()} disabled={experimentBusy || status.plan.experiments.length >= 100}>{experimentBusy ? 'Đang lưu…' : 'Ghi thử nghiệm'}</Button>
      </div>
      {status.plan.experiments.length === 0 ? <p className={styles.muted}>Chưa ghi thử nghiệm nào.</p> : <ul className={styles.experimentList}>{[...status.plan.experiments].reverse().map((experiment) => <li key={experiment.id}><div><strong>{formatGrowthDate(experiment.date)} · {VARIABLE_LABELS[experiment.variable]}</strong><span>{experiment.note || 'Không có ghi chú'}</span>{experiment.videoIds?.length ? <small>{experiment.videoIds.join(', ')}</small> : null}</div><Button size="sm" onClick={() => void deleteExperiment(experiment.id)}>Xóa</Button></li>)}</ul>}
    </section>
  </>;
}

export function GrowthPlanPanel({ channelId }: { channelId: string }) {
  const statusQuery = useYoutubeGrowthPlanStatus(channelId);
  const planQuery = useYoutubeGrowthPlan(channelId);
  const error = statusQuery.error ?? planQuery.error;
  return <section className={styles.panel} aria-labelledby="growth-plan-heading">
    <div className={styles.panelHeading}><div><h2 id="growth-plan-heading">Kế hoạch &amp; mục tiêu</h2><p>Đo mốc video 28 ngày, đối chiếu điều kiện tham khảo và đánh giá theo tiêu chí đã đặt.</p></div></div>
    {statusQuery.isLoading || planQuery.isLoading ? <p className={styles.state} role="status">Đang tải kế hoạch tăng trưởng…</p>
      : error ? <div className={styles.stateError} role="alert"><p>{error instanceof Error ? error.message : 'Không tải được kế hoạch tăng trưởng.'}</p><Button size="sm" onClick={() => { void statusQuery.refetch(); void planQuery.refetch(); }}>Thử lại</Button></div>
        : statusQuery.data ? <GrowthPlanContent channelId={channelId} status={statusQuery.data} /> : <p className={styles.state}>Chưa có dữ liệu kế hoạch.</p>}
  </section>;
}
