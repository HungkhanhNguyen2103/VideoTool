import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_MODEL_REGISTRY, getDefaultAiModelId } from '../../../../contracts/ai-models';
import type { YoutubeReviewClaim, YoutubeReviewIdea, YoutubeReviewSuccessCriterion, YoutubeReviewV2Result } from '../../../../contracts/youtube-review';
import { useJobProgress } from '../../../shared/hooks/use-job-progress';
import { cancelJob } from '../../../shared/job-api';
import { Button } from '../../../shared/ui/Button';
import { ApiError } from '../../../shared/api-client';
import { getYoutubeCliStatus, startYoutubeChannelReviewV2, startYoutubeVideoReviewV2 } from '../api';
import { youtubeChannelReviewV2Key, youtubeGrowthPlanStatusKey, youtubeVideoReviewV2Key, useYoutubeChannelReviewV2, useYoutubeGrowthPlanStatus, useYoutubeVideoReviewV2 } from '../hooks';
import { formatYoutubeReviewCitation, formatYoutubeReviewMetric, youtubeReviewCriterionText, youtubeReviewGroundingBadgeText, youtubeReviewIdeasGateText, youtubeReviewMappingLabel, youtubeReviewSceneRange, youtubeReviewStaleText, type YoutubeReviewMetric } from '../review-view';
import styles from './ReviewV2Panel.module.css';

type Props = { channelId: string; target: 'channel' | 'video'; videoId?: string; onOpenVideo?: (videoId: string) => void };

function localError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Criterion({ value, metrics }: { value: YoutubeReviewSuccessCriterion; metrics: Record<string, YoutubeReviewMetric> }) {
  return <p className={styles.criterion}><span aria-hidden="true">✓</span>{youtubeReviewCriterionText(value, metrics)}</p>;
}

function CitationChips({ ids, review, onOpenVideo }: { ids: string[]; review: YoutubeReviewV2Result; onOpenVideo?: (videoId: string) => void }) {
  if (!ids.length) return null;
  function follow(metricId: string) {
    if (metricId.startsWith('v:')) {
      const videoId = metricId.slice(2).split(':')[0];
      if (videoId) onOpenVideo?.(videoId);
    }
    const node = document.getElementById(metricId) ?? document.getElementById(`registry-${metricId}`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const highlightClass = styles.highlight;
    if (node && highlightClass) {
      node.classList.add(highlightClass);
      window.setTimeout(() => node.classList.remove(highlightClass), 1_400);
    }
  }
  return <div className={styles.citations} aria-label="Số liệu được trích dẫn">
    {ids.map((id) => {
      const citation = formatYoutubeReviewCitation(review.metricMap, id);
      return citation.missing ? <span className={styles.citationMissing} key={id}>{citation.label}: {citation.value}</span> : <button className={styles.citation} type="button" key={id} onClick={() => follow(id)} title="Tìm số liệu trong kế hoạch hoặc mở video">
        <span>{citation.label}</span><strong>{citation.value}</strong>
      </button>;
    })}
  </div>;
}

function ClaimList({ rows, review, onOpenVideo, empty }: { rows: YoutubeReviewClaim[]; review: YoutubeReviewV2Result; onOpenVideo?: (videoId: string) => void; empty: string }) {
  return rows.length ? <ul className={styles.claims}>{rows.map((row, index) => <li key={`${index}-${row.text}`}>
    <p>{row.text}</p><CitationChips ids={row.metricIds} review={review} onOpenVideo={onOpenVideo} />
  </li>)}</ul> : <p className={styles.muted}>{empty}</p>;
}

function ReviewResult({ review, channelId, target, onOpenVideo, onRerun, rerunDisabled }: { review: YoutubeReviewV2Result; channelId: string; target: Props['target']; onOpenVideo?: (videoId: string) => void; onRerun: () => void; rerunDisabled: boolean }) {
  const statusQuery = useYoutubeGrowthPlanStatus(channelId, target === 'channel');
  const staleText = youtubeReviewStaleText(review.stale);
  const date = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(review.generatedAt));
  const channelAnalysis = target === 'channel' && 'diagnosis' in review.analysis ? review.analysis : null;

  return <div className={styles.result}>
    {staleText && <aside className={styles.stale} role="status"><span>{staleText}</span><Button size="sm" onClick={onRerun} disabled={rerunDisabled}>Phân tích lại</Button></aside>}
    <div className={styles.meta}><span>{review.backend === 'cli' ? 'Claude CLI' : 'API'} · {review.model}</span><time>{date}</time></div>
    <p className={styles.summary}>{review.analysis.summary}</p>
    {channelAnalysis && statusQuery.data && <section className={styles.verdict} aria-label="Kết luận xác định từ kế hoạch tăng trưởng">
      <strong>{({ insufficient_data: 'Chưa đủ dữ liệu', continue: 'Tiếp tục', change_one_variable: 'Đổi một biến', consider_stop: 'Cân nhắc dừng ngách' } as const)[statusQuery.data.verdict.verdict]}</strong>
      <ul>{statusQuery.data.verdict.reasons.map((reason, index) => <li key={`${index}-${reason.text}`}>{reason.text}</li>)}</ul>
    </section>}
    <p className={styles.grounding}>{youtubeReviewGroundingBadgeText(review.groundingReport)}</p>
    {channelAnalysis ? <>
      <div className={styles.columns}>
        <section className={styles.resultCard}><h4>Điểm mạnh</h4><ClaimList rows={channelAnalysis.strengths} review={review} onOpenVideo={onOpenVideo} empty="Chưa có điểm mạnh đủ căn cứ." /></section>
        <section className={styles.resultCard}><h4>Điểm yếu</h4><ClaimList rows={channelAnalysis.weaknesses} review={review} onOpenVideo={onOpenVideo} empty="Chưa có điểm yếu đủ căn cứ." /></section>
      </div>
      <section className={styles.resultCard}>
        <h4>Chẩn đoán</h4>
        <span className={styles.badge}>{({ niche: 'Ngách', execution: 'Cách làm', unclear: 'Chưa rõ' } as const)[channelAnalysis.diagnosis.classification]}</span>
        <p>{channelAnalysis.diagnosis.reasoning}</p><CitationChips ids={channelAnalysis.diagnosis.metricIds} review={review} onOpenVideo={onOpenVideo} />
      </section>
      <section className={styles.resultCard}><h4>Kế hoạch hành động</h4>
        {channelAnalysis.actionPlan.length ? <ol className={styles.actionList}>{channelAnalysis.actionPlan.map((step, index) => <li key={`${index}-${step.step}`}>
          <div><strong>{step.step}</strong><span className={styles.variable}>{({ topic: 'Chủ đề', title: 'Tiêu đề', thumbnail: 'Thumbnail', hook: 'Mở đầu', length: 'Độ dài', cadence: 'Nhịp đăng', other: 'Khác' } as const)[step.variable]}</span></div>
          <p>{step.why}</p><Criterion value={step.successCriterion} metrics={review.metricMap} /><CitationChips ids={step.metricIds} review={review} onOpenVideo={onOpenVideo} />
        </li>)}</ol> : <p className={styles.muted}>Chưa có bước hành động đủ căn cứ.</p>}
      </section>
      <Limits rows={review.analysis.limits} />
      {review.ideas?.status === 'gated' ? <section className={styles.resultCard}><h4>Ý tưởng video tiếp theo</h4><p className={styles.gated}>{youtubeReviewIdeasGateText(review.packetSummary.matureCount, review.ideas.reason)}</p></section> : review.ideas?.status === 'generated' ? <section className={styles.resultCard}><h4>Ý tưởng video tiếp theo</h4>
        {review.ideas.items.length ? <div className={styles.ideas}>{review.ideas.items.map((idea, index) => <Idea key={`${index}-${idea.title}`} idea={idea} review={review} onOpenVideo={onOpenVideo} />)}</div> : <p className={styles.muted}>Chưa có ý tưởng đủ căn cứ.</p>}
      </section> : null}
    </> : 'retentionFindings' in review.analysis ? <VideoResult review={review} onOpenVideo={onOpenVideo} /> : null}
  </div>;
}

function Limits({ rows }: { rows: string[] }) {
  return <section className={styles.resultCard}><h4>Giới hạn dữ liệu</h4>{rows.length ? <ul className={styles.simpleList}>{rows.map((row, index) => <li key={`${index}-${row}`}>{row}</li>)}</ul> : <p className={styles.muted}>Không có giới hạn bổ sung được nêu.</p>}</section>;
}

function Idea({ idea, review, onOpenVideo }: { idea: YoutubeReviewIdea; review: YoutubeReviewV2Result; onOpenVideo?: (videoId: string) => void }) {
  const ids = idea.basedOn.metricIds;
  return <article className={styles.idea}><h5>{idea.title}</h5><p>{idea.angle}</p><p><strong>Giả thuyết:</strong> {idea.hypothesis}</p><p><strong>Rủi ro:</strong> {idea.risk}</p><Criterion value={idea.successCriterion} metrics={review.metricMap} /><CitationChips ids={ids} review={review} onOpenVideo={onOpenVideo} /></article>;
}

function VideoResult({ review, onOpenVideo }: { review: YoutubeReviewV2Result; onOpenVideo?: (videoId: string) => void }) {
  if (!('retentionFindings' in review.analysis)) return null;
  const context = review.videoContext;
  const mappingQuality = context?.mappingQuality ?? 'none';
  const metricMap = review.metricMap;
  return <>
    <div className={styles.columns}>
      <section className={styles.resultCard}><h4>Điểm mạnh</h4><ClaimList rows={review.analysis.strengths} review={review} onOpenVideo={onOpenVideo} empty="Chưa có điểm mạnh đủ căn cứ." /></section>
      <section className={styles.resultCard}><h4>Điểm yếu</h4><ClaimList rows={review.analysis.weaknesses} review={review} onOpenVideo={onOpenVideo} empty="Chưa có điểm yếu đủ căn cứ." /></section>
    </div>
    <section className={styles.resultCard}><h4>Giữ chân và cảnh</h4>
      <span className={styles.badge}>{youtubeReviewMappingLabel(mappingQuality)}</span>
      {review.analysis.retentionFindings.length ? <ol className={styles.retentionList}>{review.analysis.retentionFindings.map((finding, index) => {
        const source = context?.retentionDrops.find((drop) => drop.fromSec === finding.fromSec && drop.toSec === finding.toSec);
        return <li key={`${finding.fromSec}-${finding.toSec}-${index}`}>
          <strong>{youtubeReviewSceneRange(finding.fromSec, finding.toSec)}{finding.sceneIndexes.length ? ` · cảnh ${finding.sceneIndexes.join(', ')}` : ''}</strong>
          <p>{finding.observation}</p><p>{finding.suggestion}</p>
          {source?.narrationExcerpt && <details><summary>Trích đoạn lời dẫn</summary><blockquote>{source.narrationExcerpt}</blockquote></details>}
          {context?.linkedProjectId && finding.sceneIndexes.map((sceneIndex) => <Link className={styles.sceneLink} key={sceneIndex} to={`/production/${encodeURIComponent(context.linkedProjectId!)}/studio?scene=${sceneIndex}`}>Mở cảnh {sceneIndex} trong dự án</Link>)}
        </li>;
      })}</ol> : <p className={styles.muted}>Chưa có đoạn giữ chân đủ căn cứ.</p>}
    </section>
    <section className={styles.resultCard}><h4>Từ khóa tìm kiếm</h4>
      {context?.searchTerms.map((window) => <details key={window.window} open={window.window === 'last28d'}>
        <summary>{window.window === 'last28d' ? '28 ngày gần nhất' : 'Toàn thời gian'} · {window.status === 'ok' ? `${window.terms.length} từ khóa` : 'chưa khả dụng'}</summary>
        {window.terms.length ? <div className={styles.termTableWrap}><table className={styles.termTable}><thead><tr><th>Từ khóa</th><th>Lượt xem</th><th>Tỷ trọng</th></tr></thead><tbody>{window.terms.map((term) => {
          const viewsMetric = Object.entries(metricMap).find(([id]) => id.includes(`:${window.window}:`) && id.includes(`:${term.rank}:views`))?.[1];
          return <tr key={`${window.window}-${term.rank}`}><td>{term.term}</td><td>{term.views === null ? 'Chưa có dữ liệu' : formatYoutubeReviewMetric(viewsMetric ?? { value: term.views, unit: 'views', label: term.term })}</td><td>{term.share === null ? 'Chưa có dữ liệu' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(term.share)}%`}</td></tr>;
        })}</tbody></table></div> : <p className={styles.muted}>Không có từ khóa được trả về trong báo cáo này.</p>}
      </details>)}
      <p className={styles.muted}>YouTube ẩn các từ khóa ít lượt; danh sách trống không có nghĩa là không có lượt tìm kiếm.</p>
      {review.analysis.searchFindings.map((finding, index) => <article className={styles.finding} key={`${finding.rank}-${index}`}><p>{finding.observation}</p><CitationChips ids={finding.metricIds} review={review} onOpenVideo={onOpenVideo} /></article>)}
    </section>
    <section className={styles.resultCard}><h4>Thay đổi tiếp theo</h4>
      <div><strong>{({ topic: 'Chủ đề', title: 'Tiêu đề', thumbnail: 'Thumbnail', hook: 'Mở đầu', length: 'Độ dài', cadence: 'Nhịp đăng', other: 'Khác' } as const)[review.analysis.nextChange.variable]}</strong><p>{review.analysis.nextChange.why}</p></div>
      <Criterion value={review.analysis.nextChange.successCriterion} metrics={metricMap} /><CitationChips ids={review.analysis.nextChange.metricIds} review={review} onOpenVideo={onOpenVideo} />
    </section>
    <Limits rows={review.analysis.limits} />
  </>;
}

export function ReviewV2Panel({ channelId, target, videoId, onOpenVideo }: Props) {
  const queryClient = useQueryClient();
  const channelQuery = useYoutubeChannelReviewV2(channelId, target === 'channel');
  const videoQuery = useYoutubeVideoReviewV2(channelId, target === 'video' ? videoId ?? null : null);
  const resultQuery = target === 'channel' ? channelQuery : videoQuery;
  const [backend, setBackend] = useState<'cli' | 'api'>('cli');
  const [cliModel, setCliModel] = useState<string>(getDefaultAiModelId('claude'));
  const [jobId, setJobId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const progress = useJobProgress(jobId);
  const cliStatusQuery = useQuery({ queryKey: ['script', 'claude-cli-status'], queryFn: getYoutubeCliStatus, enabled: backend === 'cli', staleTime: 15_000, retry: false });
  const active = Boolean(jobId && (!progress || ['queued', 'running'].includes(progress.status)));

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (progress?.status !== 'done') return;
    void queryClient.invalidateQueries({ queryKey: target === 'channel' ? youtubeChannelReviewV2Key(channelId) : youtubeVideoReviewV2Key(channelId, videoId ?? '') });
    void queryClient.invalidateQueries({ queryKey: youtubeGrowthPlanStatusKey(channelId) });
  }, [channelId, progress?.status, queryClient, target, videoId]);

  async function runReview() {
    if (target === 'video' && !videoId) return;
    setStarting(true); setStartError(null);
    try {
      const result = target === 'channel'
        ? await startYoutubeChannelReviewV2(channelId, { backend, ...(backend === 'cli' ? { cliModel } : {}) })
        : await startYoutubeVideoReviewV2(channelId, videoId!, { backend, ...(backend === 'cli' ? { cliModel } : {}) });
      setJobId(result.jobId); setStartedAt(Date.now());
    } catch (error) {
      if (error instanceof ApiError && error.code === 'YOUTUBE_REVIEW_ALREADY_RUNNING' && error.jobId) {
        setJobId(error.jobId); setStartedAt(Date.now());
      } else setStartError(localError(error, 'Không thể bắt đầu phân tích YouTube.'));
    }
    finally { setStarting(false); }
  }

  async function cancelReview() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try { await cancelJob(jobId); }
    catch (error) { setStartError(localError(error, 'Không thể gửi yêu cầu hủy.')); }
    finally { setCancelling(false); }
  }

  function closeProgress() { setJobId(null); setStartedAt(null); }
  const elapsed = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1_000));
  const cliUnavailable = backend === 'cli' && !cliStatusQuery.isLoading && (cliStatusQuery.error || cliStatusQuery.data?.available !== true);
  const review = resultQuery.data;

  return <section className={styles.panel} aria-labelledby={`review-v2-${target}-title`}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>GROUNDED REVIEW · YOUTUBE</p><h3 id={`review-v2-${target}-title`}>{target === 'channel' ? 'Đánh giá chi tiết bằng Claude' : 'Đánh giá video bằng Claude'}</h3><p className={styles.muted}>Mọi nhận định được đối chiếu với số liệu đã đồng bộ; Claude không thay đổi kết luận của kế hoạch tăng trưởng.</p></div>
      <Button variant="amber" onClick={() => void runReview()} disabled={starting || active || Boolean(cliUnavailable) || (backend === 'cli' && cliStatusQuery.isLoading)}>{starting ? 'Đang xếp hàng…' : active ? 'Đang phân tích…' : target === 'channel' ? 'Phân tích kênh' : 'Phân tích video'}</Button>
    </header>
    <div className={styles.controls}>
      <label>Backend<select value={backend} disabled={active} onChange={(event) => setBackend(event.target.value as 'cli' | 'api')}><option value="cli">Claude CLI</option><option value="api">API</option></select></label>
      {backend === 'cli' && <label>Model Claude<select value={cliModel} disabled={active} onChange={(event) => setCliModel(event.target.value)}>{AI_MODEL_REGISTRY.claude.models.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.hint}</option>)}</select></label>}
    </div>
    {backend === 'cli' && <p className={cliUnavailable ? styles.error : styles.muted} role={cliUnavailable ? 'alert' : undefined}>{cliStatusQuery.isLoading ? 'Đang kiểm tra Claude Code CLI…' : cliUnavailable ? (cliStatusQuery.data?.reason ?? 'Không kiểm tra được trạng thái Claude Code CLI.') : `Claude Code CLI sẵn sàng${cliStatusQuery.data?.version ? ` · ${cliStatusQuery.data.version}` : ''}.`}</p>}
    {startError && <p className={styles.error} role="alert">{startError}</p>}
    {resultQuery.isLoading && <p className={styles.muted} role="status">Đang tải đánh giá…</p>}
    {resultQuery.error && <div className={styles.errorBox} role="alert"><span>{localError(resultQuery.error, 'Không tải được đánh giá.')}</span><Button size="sm" onClick={() => void resultQuery.refetch()}>Thử lại</Button></div>}
    {!resultQuery.isLoading && !resultQuery.error && !review && !active && <p className={styles.muted}>Chưa có đánh giá.</p>}
    {jobId && <section className={styles.progress} aria-label="Tiến độ đánh giá YouTube">
      <div className={styles.progressTop}><strong>{progress?.logs.slice().reverse().find((line) => line.startsWith('Bước '))?.split(':')[0] ?? (progress?.status === 'done' ? 'Hoàn tất' : 'Đang chờ worker…')}</strong><span>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span></div>
      <progress max={100} value={progress?.progress ?? 0} aria-label="Phần trăm hoàn thành" />
      {progress?.status === 'failed' && <p className={styles.error} role="alert">{progress.error ?? 'Phân tích thất bại.'}</p>}
      {progress?.status === 'cancelled' && <p className={styles.muted} role="status">Đã hủy phân tích; đánh giá đã lưu trước đó vẫn được giữ.</p>}
      <div className={styles.logActions}><button type="button" className={styles.linkButton} aria-expanded={logsOpen} onClick={() => setLogsOpen((open) => !open)}>{logsOpen ? 'Ẩn log' : 'Xem log'}</button>
        {active ? <Button size="sm" onClick={() => void cancelReview()} disabled={cancelling}>{cancelling ? 'Đang gửi…' : 'Hủy'}</Button> : <Button size="sm" onClick={closeProgress}>Đóng</Button>}
      </div>
      {logsOpen && <ol className={styles.logs} role="log" aria-live="polite">{(progress?.logs ?? []).slice(-30).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>}
    </section>}
    {review && <ReviewResult review={review} channelId={channelId} target={target} onOpenVideo={onOpenVideo} onRerun={() => void runReview()} rerunDisabled={starting || active || Boolean(cliUnavailable)} />}
  </section>;
}
