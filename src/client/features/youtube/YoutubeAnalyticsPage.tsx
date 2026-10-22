import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../shared/ui/Button';
import { ChannelYoutubeControls } from './components/ChannelYoutubeControls';
import { GrowthPlanPanel } from './components/GrowthPlanPanel';
import { ReviewV2Panel } from './components/ReviewV2Panel';
import { useChannels } from '../channel/hooks';
import { useProjects } from '../project/hooks';
import { useYoutubeOverview, useYoutubeSuggestedLinks, useYoutubeVideo, useYoutubeVideos, invalidateYoutubeLinkQueries, youtubeChannelsOverviewKey, youtubeGrowthPlanStatusKey } from './hooks';
import { clearYoutubeManualReach, linkProjectToYoutubeVideo, saveYoutubeManualReach, setYoutubePlanExclusion, unlinkProjectFromYoutubeVideo } from './api';
import type { YoutubeChannelHealth, YoutubePartnerThresholds, YoutubeVideoListItem } from '../../../contracts/youtube-analytics';
import type { YoutubeVideoStats } from '../../../contracts/youtube';
import { formatYoutubeMetric, lineChartPath, youtubeThresholdSourceLinks, YOUTUBE_CTR_UNAVAILABLE_TOOLTIP, YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP } from './youtube-view';
import styles from './YoutubeAnalyticsPage.module.css';

type SortKey = 'viewsPerDay' | 'averageViewPercentage' | 'clickThroughRate' | 'subscribersPerThousandViews';
type WindowKey = '28d' | '90d' | '365d' | 'lifetime';
type VideoKind = 'all' | 'long' | 'short';

const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const DATE_TIME = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });

function maybeDate(value: string | null | undefined): string {
  return value ? DATE_TIME.format(new Date(value)) : 'Chưa có dữ liệu';
}

function ChangeText({ value }: { value: number | null }) {
  if (value === null) return <small>Chưa có dữ liệu để so sánh</small>;
  const prefix = value > 0 ? '+' : '';
  return <small className={value < 0 ? styles.negative : styles.positive}>{prefix}{NUMBER.format(value)}% so với 28 ngày trước</small>;
}

function TrendTile({ title, value, change, suffix = '' }: { title: string; value: number | null; change: number | null; suffix?: string }) {
  return <article className={styles.trendTile}><span>{title}</span><strong title={value === null ? YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP : undefined}>{value === null ? 'Chưa có dữ liệu' : `${NUMBER.format(value)}${suffix}`}</strong>{value !== null && <ChangeText value={change} />}</article>;
}

function DailyChart({ rows, metric, title, valueFormat }: { rows: { date: string; value: number }[]; metric: string; title: string; valueFormat: (value: number) => string }) {
  const recent = rows.slice(-28);
  const path = lineChartPath(recent.map((row) => row.value), 320, 92);
  return (
    <figure className={styles.chart}>
      <figcaption><strong>{title}</strong><span>{recent.length ? `${recent.length} ngày gần nhất` : 'Chưa có dữ liệu'}</span></figcaption>
      {path ? <>
        <svg viewBox="0 0 320 100" role="img" aria-label={`${title}, ${recent.length} điểm theo ngày`} preserveAspectRatio="none">
          <path d="M0,99 L320,99" className={styles.chartAxis} />
          <path d={path} className={styles.chartLine} />
        </svg>
        <div className={styles.chartSummary}><span>{recent[0]?.date}</span><span>{valueFormat(Math.max(...recent.map((row) => row.value)))} cao nhất/ngày</span><span>{recent.at(-1)?.date}</span></div>
      </> : <p className={styles.emptyInline}>Chưa có dữ liệu cho biểu đồ này.</p>}
      <span className={styles.srOnly}>{metric}</span>
    </figure>
  );
}

function ProgressMetric({ label, actual, required, progress }: { label: string; actual: number | null; required: number; progress: number | null }) {
  return (
    <div className={styles.progressMetric}>
      <div><span>{label}</span><small title={actual === null ? YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP : undefined}>{formatYoutubeMetric(actual).text} / {NUMBER.format(required)}</small></div>
      {progress === null ? <small title={YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP}>Chưa có dữ liệu</small> : <progress max={1} value={progress} aria-label={`${label}: ${Math.round(progress * 100)}%`} />}
    </div>
  );
}

function ThresholdTier({ label, values, subscribers }: { label: string; values: YoutubeChannelHealth['current']['entryTier']; subscribers: number | null }) {
  return (
    <section className={styles.thresholdTier}>
      <h4>{label}{values.eligible && <span className={styles.eligible}>Đạt mốc tham khảo</span>}</h4>
      <ProgressMetric label="Người đăng ký" actual={subscribers} required={values.subscribers} progress={values.subscribersProgress} />
      <ProgressMetric label="Giờ xem video dài" actual={values.publicLongWatchHours} required={values.longWatchHours} progress={values.watchHoursProgress} />
      <ProgressMetric label="Lượt xem Shorts" actual={values.publicShortViews} required={values.shortViews} progress={values.shortViewsProgress} />
    </section>
  );
}

function ThresholdPanel({ health, thresholds }: { health: YoutubeChannelHealth; thresholds: YoutubePartnerThresholds }) {
  const sourceLinks = youtubeThresholdSourceLinks(thresholds.sourceUrls);
  return (
    <section className={styles.panel} aria-labelledby="threshold-heading">
      <div className={styles.panelHeading}>
        <div><h2 id="threshold-heading">Tiến độ tham khảo YPP</h2><p>{health.note}</p></div>
        <span className={styles.checkedDate}>Kiểm tra ngày {thresholds.checkedOn}</span>
      </div>
      <div className={styles.thresholdColumns}>
        <div className={styles.thresholdColumn}><h3>Hiện tại</h3><ThresholdTier label="Quyền fan funding sớm" values={health.current.entryTier} subscribers={health.subscribers} /><ThresholdTier label="Quảng cáo và Premium" values={health.current.ads} subscribers={health.subscribers} /></div>
        <div className={styles.thresholdColumn}><h3>Từ 01/02/2027</h3><ThresholdTier label="Quyền fan funding sớm" values={health.from2027_02_01.entryTier} subscribers={health.subscribers} /><ThresholdTier label="Quảng cáo và Premium" values={health.from2027_02_01.ads} subscribers={health.subscribers} /></div>
      </div>
      <div className={styles.thresholdSources} aria-label="Nguồn tham khảo YPP">Nguồn: {sourceLinks.map((source, index) => <a key={source.href} href={source.href} target="_blank" rel="noreferrer noopener">{index > 0 && ' · '}{source.label}</a>)}</div>
      <p className={styles.muted} title={health.publicUploads90d === null ? YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP : undefined}>Video công khai trong 90 ngày: {formatYoutubeMetric(health.publicUploads90d).text}</p>
      <p className={styles.referenceNote}>Số liệu của ứng dụng chỉ là ước tính từ API và không xác định điều kiện đủ chuẩn. YouTube Studio luôn là nguồn chính thức. Không tính doanh thu.</p>
    </section>
  );
}

function VideoRetention({ video }: { video: YoutubeVideoStats }) {
  const curve = 'retentionCurve' in video ? (video as YoutubeVideoStats & { retentionCurve: { ratio: number; watchRatio: number }[] | null }).retentionCurve : null;
  const points = curve ?? [];
  const max = Math.max(1, ...points.map((point) => point.watchRatio));
  const path = lineChartPath(points.map((point) => point.watchRatio / max), 320, 100);
  const drops = 'dropSegments' in video ? (video as YoutubeVideoStats & { dropSegments?: { earlyDrop: boolean; segments: { startSec: number; endSec: number; dropPercent: number }[] } | null }).dropSegments : null;
  const reason = 'retentionUnavailableReason' in video ? (video as YoutubeVideoStats & { retentionUnavailableReason?: string }).retentionUnavailableReason : undefined;
  return (
    <section className={styles.detailSection}>
      <h3>Giữ chân người xem</h3>
      {path ? <>
        <svg className={styles.retentionChart} viewBox="0 0 320 108" role="img" aria-label="Đường giữ chân người xem theo tỷ lệ thời lượng video">
          <path d="M0,105 L320,105" className={styles.chartAxis} /><path d={path} className={styles.retentionLine} />
          {drops?.segments.slice(0, 3).map((segment, index) => <circle key={`${index}-${segment.startSec}`} cx={segment.startSec / Math.max(1, video.durationSec) * 320} cy={105 - (points.find((point) => Math.abs(point.ratio * video.durationSec - segment.endSec) < 1)?.watchRatio ?? 0) / max * 100} r="3.5" className={styles.dropDot} />)}
        </svg>
        {drops?.earlyDrop && <p className={styles.warning}>Rớt người xem sớm: đường giữ chân giảm mạnh trong 30 giây đầu.</p>}
        <ol className={styles.dropList}>{(drops?.segments ?? []).map((segment, index) => <li key={`${segment.startSec}-${segment.endSec}`}><strong>{index + 1}.</strong> {NUMBER.format(segment.startSec)}–{NUMBER.format(segment.endSec)} giây: giảm {NUMBER.format(segment.dropPercent)}%</li>)}</ol>
      </> : <p className={styles.emptyInline} title={YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP}>{reason ?? 'Chưa có dữ liệu giữ chân cho video này.'}</p>}
    </section>
  );
}

function VideoDetailDrawer({ channelId, videoId, onClose, onOpenVideo }: { channelId: string; videoId: string | null; onClose: () => void; onOpenVideo: (videoId: string) => void }) {
  const queryClient = useQueryClient();
  const detailQuery = useYoutubeVideo(channelId, videoId);
  const projectsQuery = useProjects({});
  const [linkError, setLinkError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualImpressions, setManualImpressions] = useState('');
  const [manualCtr, setManualCtr] = useState('');
  const [reachBusy, setReachBusy] = useState(false);
  const [exclusionBusy, setExclusionBusy] = useState(false);
  const video = detailQuery.data;
  const averageViewDuration = video?.analytics['28d']?.averageViewDurationSec;
  const averageViewPercentage = video?.analytics['28d']?.averageViewPercentage;
  const candidateProjects = (projectsQuery.data ?? []).filter((project) => project.channelId === channelId && (!project.youtubeVideoId || project.youtubeVideoId === videoId));

  useEffect(() => {
    setManualImpressions(video?.manualReach ? String(video.manualReach.impressions) : '');
    setManualCtr(video?.manualReach ? String(video.manualReach.ctrPercent) : '');
  }, [video?.videoId, video?.manualReach?.enteredAt]);

  async function refreshGrowthData() {
    await Promise.all([
      invalidateYoutubeLinkQueries(queryClient, channelId, videoId ?? undefined),
      queryClient.invalidateQueries({ queryKey: youtubeGrowthPlanStatusKey(channelId) }),
      queryClient.invalidateQueries({ queryKey: youtubeChannelsOverviewKey }),
    ]);
  }

  async function saveManualReach() {
    if (!video) return;
    setLinkError(null); setMessage(null);
    const impressions = Number(manualImpressions);
    const ctrPercent = Number(manualCtr);
    if (!manualImpressions.trim() || !manualCtr.trim() || !Number.isInteger(impressions) || impressions < 0 || !Number.isFinite(ctrPercent) || ctrPercent < 0 || ctrPercent > 100) {
      setLinkError('Nhập lượt hiển thị là số nguyên không âm và CTR từ 0 đến 100%.');
      return;
    }
    setReachBusy(true);
    try {
      await saveYoutubeManualReach(channelId, video.videoId, { impressions, ctrPercent });
      await refreshGrowthData();
      setMessage('Đã lưu số liệu nhập tay từ Studio.');
    } catch (caught) { setLinkError(caught instanceof Error ? caught.message : 'Không thể lưu số liệu Reach.'); }
    finally { setReachBusy(false); }
  }

  async function clearManualReach() {
    if (!video) return;
    setReachBusy(true); setLinkError(null); setMessage(null);
    try {
      await clearYoutubeManualReach(channelId, video.videoId);
      setManualImpressions(''); setManualCtr('');
      await refreshGrowthData();
      setMessage('Đã xóa số liệu nhập tay.');
    } catch (caught) { setLinkError(caught instanceof Error ? caught.message : 'Không thể xóa số liệu Reach.'); }
    finally { setReachBusy(false); }
  }

  async function togglePlanExclusion() {
    if (!video) return;
    setExclusionBusy(true); setLinkError(null); setMessage(null);
    try {
      await setYoutubePlanExclusion(channelId, video.videoId, !video.excludedFromPlan);
      await refreshGrowthData();
      setMessage(video.excludedFromPlan ? 'Đã đưa video trở lại kế hoạch.' : 'Đã loại video khỏi kế hoạch.');
    } catch (caught) { setLinkError(caught instanceof Error ? caught.message : 'Không thể cập nhật kế hoạch video.'); }
    finally { setExclusionBusy(false); }
  }

  async function updateLink(projectId: string | null) {
    if (!video) return;
    setLinkError(null);
    setMessage(null);
    try {
      if (projectId) await linkProjectToYoutubeVideo(projectId, video.videoId);
      else if (video.linkedProject) await unlinkProjectFromYoutubeVideo(video.linkedProject.id);
      await invalidateYoutubeLinkQueries(queryClient, channelId, video.videoId);
      await projectsQuery.refetch();
      setMessage(projectId ? 'Đã liên kết dự án với video.' : 'Đã gỡ liên kết dự án.');
    } catch (caught) {
      setLinkError(caught instanceof Error ? caught.message : 'Không thể cập nhật liên kết video.');
    }
  }

  if (!videoId) return null;
  if (detailQuery.isLoading) return <div className={styles.drawerOverlay}><div className={styles.drawerBackdrop} /><section className={styles.drawer} role="dialog" aria-modal="true" aria-label="Chi tiết video"><Button onClick={onClose}>Đóng</Button><p role="status">Đang tải số liệu video…</p></section></div>;
  if (detailQuery.error || !video) return <div className={styles.drawerOverlay}><button className={styles.drawerBackdrop} aria-label="Đóng chi tiết video" onClick={onClose} /><section className={styles.drawer} role="dialog" aria-modal="true" aria-label="Chi tiết video"><header className={styles.drawerHeader}><h2>Chi tiết video</h2><Button onClick={onClose}>Đóng</Button></header><p className={styles.error} role="alert">{detailQuery.error instanceof Error ? detailQuery.error.message : 'Không tải được chi tiết video.'}</p><Button onClick={() => void detailQuery.refetch()}>Thử lại</Button></section></div>;

  return (
    <div className={styles.drawerOverlay}>
      <button className={styles.drawerBackdrop} aria-label="Đóng chi tiết video" onClick={onClose} />
      <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="video-drawer-title">
        <header className={styles.drawerHeader}><div><p className={styles.eyebrow}>VIDEO ĐÃ ĐỒNG BỘ</p><h2 id="video-drawer-title">{video.title}</h2></div><Button onClick={onClose}>Đóng</Button></header>
        <p className={styles.muted}>Đăng {maybeDate(video.publishedAt)} · {Math.floor(video.durationSec / 60)}:{String(video.durationSec % 60).padStart(2, '0')} · {video.privacy}</p>
        <div className={styles.detailStats}>
          <article><span>Lượt xem tổng</span><strong>{formatYoutubeMetric(video.viewCount).text}</strong></article>
          <article><span>Thời lượng xem TB (28 ngày)</span><strong title={averageViewDuration === null || averageViewDuration === undefined ? YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP : undefined}>{formatYoutubeMetric(averageViewDuration).text}{averageViewDuration !== undefined && averageViewDuration !== null ? ' giây' : ''}</strong></article>
          <article><span>Tỷ lệ xem TB (28 ngày)</span><strong title={averageViewPercentage === null || averageViewPercentage === undefined ? YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP : undefined}>{formatYoutubeMetric(averageViewPercentage, { style: 'percent' }).text}</strong></article>
          <article><span>CTR</span><strong title={YOUTUBE_CTR_UNAVAILABLE_TOOLTIP}>Chưa có dữ liệu</strong></article>
        </div>
        <section className={styles.detailSection}>
          <h3>Mốc 28 ngày đầu</h3>
          {video.first28d ? <div className={styles.detailStats}>
            <article><span>Lượt xem</span><strong>{formatYoutubeMetric(video.first28d.views).text}</strong></article>
            <article><span>Phút xem</span><strong>{formatYoutubeMetric(video.first28d.estimatedMinutesWatched).text}</strong></article>
            <article><span>Thời lượng xem TB</span><strong>{formatYoutubeMetric(video.first28d.averageViewDurationSec).text}{video.first28d.averageViewDurationSec !== null ? ' giây' : ''}</strong></article>
            <article><span>Đã ghi nhận</span><strong>{maybeDate(video.first28d.capturedAt)}</strong></article>
          </div> : <p className={styles.emptyInline}>Chưa có snapshot cố định. Snapshot được lấy khi video đủ 31 ngày và Analytics đã kịp cập nhật.</p>}
        </section>
        <section className={styles.detailSection}>
          <h3>Nhập tay từ Studio (chưa tự động)</h3>
          <p className={styles.muted}>CTR chỉ được dùng trong kết luận khi có ít nhất 1.000 lượt hiển thị. CTR và lượt hiển thị chưa được đồng bộ tự động.</p>
          <div className={styles.reachForm}>
            <label>Lượt hiển thị<input type="number" min="0" step="1" value={manualImpressions} onChange={(event) => setManualImpressions(event.target.value)} /></label>
            <label>CTR · %<input type="number" min="0" max="100" step="0.1" value={manualCtr} onChange={(event) => setManualCtr(event.target.value)} /></label>
          </div>
          <div className={styles.drawerActions}><Button size="sm" variant="amber" onClick={() => void saveManualReach()} disabled={reachBusy}>{reachBusy ? 'Đang lưu…' : 'Lưu Reach'}</Button>{video.manualReach && <Button size="sm" onClick={() => void clearManualReach()} disabled={reachBusy}>Xóa Reach</Button>}</div>
          {video.manualReach && <small className={styles.muted}>Đã nhập {maybeDate(video.manualReach.enteredAt)} · {video.manualReach.impressions < 1_000 ? 'chưa đủ ngưỡng để CTR được xem là đã biết' : 'đủ ngưỡng 1.000 lượt hiển thị'}</small>}
          <label className={styles.excludeToggle}><input type="checkbox" checked={video.excludedFromPlan} disabled={exclusionBusy} onChange={() => void togglePlanExclusion()} /> Loại khỏi kế hoạch tăng trưởng</label>
          {linkError && <p className={styles.error} role="alert">{linkError}</p>}{message && <p className={styles.message} role="status">{message}</p>}
        </section>
        <section className={styles.detailSection}>
          <h3>So với trung vị của cùng kênh</h3>
          <p className={styles.muted}>Lượt xem/ngày: video {formatYoutubeMetric(video.channelComparison.videoViewsPerDay).text} · trung vị {formatYoutubeMetric(video.channelComparison.medianViewsPerDay).text} (n={video.channelComparison.viewsSampleSize})</p>
          <p className={styles.muted}>Tỷ lệ xem trung bình: video {formatYoutubeMetric(video.channelComparison.videoAverageViewPercentage, { style: 'percent' }).text} · trung vị {formatYoutubeMetric(video.channelComparison.medianAverageViewPercentage, { style: 'percent' }).text} (n={video.channelComparison.averageViewSampleSize})</p>
          <p className={styles.muted}>Đây là so sánh mô tả, không chứng minh nguyên nhân.</p>
        </section>
        <VideoRetention video={video} />
        <section className={styles.detailSection}>
          <h3>Liên kết dự án Video Tool</h3>
          {linkError && <p className={styles.error} role="alert">{linkError}</p>}{message && <p className={styles.message} role="status">{message}</p>}
          <label className={styles.projectSelect}>Dự án cùng hồ sơ kênh
            <select value={video.linkedProject?.id ?? ''} disabled={projectsQuery.isLoading} onChange={(event) => void updateLink(event.target.value || null)}>
              <option value="">{video.linkedProject ? 'Gỡ liên kết' : 'Chưa liên kết'}</option>
              {candidateProjects.map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}
            </select>
          </label>
          {video.linkedProject && <p className={styles.muted}>Kịch bản: {video.linkedProject.scriptPresetId ?? 'Chưa có dữ liệu'} · Hình ảnh: {video.linkedProject.visualStylePresetId ?? 'Chưa có dữ liệu'}</p>}
        </section>
        <ReviewV2Panel channelId={channelId} target="video" videoId={video.videoId} onOpenVideo={onOpenVideo} />
      </section>
    </div>
  );
}

export function YoutubeAnalyticsPage() {
  const { channelId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const channelsQuery = useChannels();
  const channel = channelsQuery.data?.find((row) => row.id === channelId);
  const connected = Boolean(channel?.youtube?.connected);
  const overviewQuery = useYoutubeOverview(channelId, connected);
  const [windowKey, setWindowKey] = useState<WindowKey>('28d');
  const [videoKind, setVideoKind] = useState<VideoKind>('all');
  const [sort, setSort] = useState<SortKey>('viewsPerDay');
  const [search, setSearch] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => new Set());
  const filters = useMemo(() => ({ sort, window: windowKey, type: videoKind, q: search.trim() }), [search, sort, videoKind, windowKey]);
  const videosQuery = useYoutubeVideos(channelId, filters, connected);
  const suggestionsQuery = useYoutubeSuggestedLinks(channelId, connected);
  const projectsQuery = useProjects({});
  const overview = overviewQuery.data;
  const videos = videosQuery.data ?? [];
  const suggestions = (suggestionsQuery.data ?? []).filter((suggestion) => !dismissedSuggestions.has(`${suggestion.projectId}:${suggestion.videoId}`));
  const unlinkedProjects = (projectsQuery.data ?? []).filter((project) => project.channelId === channelId && !project.youtubeVideoId);

  useEffect(() => {
    if (selectedVideoId && videosQuery.error) setSelectedVideoId(null);
  }, [selectedVideoId, videosQuery.error]);

  async function confirmSuggestion(projectId: string, videoId: string) {
    setLinkNotice(null);
    try {
      await linkProjectToYoutubeVideo(projectId, videoId);
      await invalidateYoutubeLinkQueries(queryClient, channelId, videoId);
      setLinkNotice('Đã xác nhận gợi ý liên kết.');
    } catch (caught) {
      setLinkNotice(caught instanceof Error ? caught.message : 'Không thể liên kết dự án và video.');
    }
  }

  if (channelsQuery.isLoading) return <main className={styles.page}><div className={styles.loading} role="status">Đang tải hồ sơ kênh…</div></main>;
  if (channelsQuery.error) return <main className={styles.page}><div className={styles.errorBox} role="alert">Không tải được hồ sơ kênh. Hãy quay lại và thử lại.</div></main>;
  if (!channel) return <main className={styles.page}><section className={styles.emptyState}><h1>Không tìm thấy hồ sơ kênh</h1><p>Hãy mở Quản lý kênh để chọn một hồ sơ đã lưu.</p><Link to="/production/init">Về trang dự án</Link></section></main>;

  const daily = (overview?.daily ?? []).map((row) => ({ date: row.date, views: row.views, watchHours: row.estimatedMinutesWatched / 60 }));
  const dailyAvailable = daily.length > 0;

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div><Link className={styles.backLink} to="/analytics">← Tất cả kênh</Link><p className={styles.eyebrow}>YOUTUBE ANALYTICS · CHỈ ĐỌC</p><h1>Phân tích kênh</h1><p>Thống kê API của kênh bạn sở hữu. Studio vẫn là nguồn chính thức.</p></div>
        <label className={styles.channelSelect}>Hồ sơ kênh
          <select value={channel.id} onChange={(event) => navigate(`/channels/${encodeURIComponent(event.target.value)}/analytics`)}>
            {(channelsQuery.data ?? []).map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}
          </select>
        </label>
      </header>

      <ChannelYoutubeControls channel={channel} />

      {!connected ? (
        <section className={styles.emptyState}><h2>Chưa có số liệu mới</h2><p>Kết nối hoặc kết nối lại hồ sơ này, sau đó chọn “Đồng bộ ngay”. Những số liệu đã lưu vẫn chỉ thuộc hồ sơ của bạn.</p></section>
      ) : overviewQuery.isLoading ? <section className={styles.loading} role="status">Đang tải phân tích kênh…</section>
        : overviewQuery.error ? <section className={styles.errorBox} role="alert"><p>{overviewQuery.error instanceof Error ? overviewQuery.error.message : 'Không tải được số liệu phân tích.'}</p><Button onClick={() => void overviewQuery.refetch()}>Thử lại</Button></section>
          : overview && <>
            <section className={styles.syncMeta}>
              <span>Đồng bộ gần nhất: {maybeDate(overview.connection.lastSyncAt)}</span>
              <span>{overview.videoCount} video đã đồng bộ</span>
              {dailyAvailable && overview.trend.tooFewData && <strong title="Một trong hai cửa sổ có dưới 100 lượt xem.">Quá ít dữ liệu để kết luận xu hướng</strong>}
            </section>
            {Object.entries(overview.analyticsStatus).filter(([, status]) => status.status !== 'ok').length > 0 && <aside className={styles.partialNotice}>
              <strong>Một số nhóm số liệu chưa có</strong>
              {Object.entries(overview.analyticsStatus).filter(([, status]) => status.status !== 'ok').map(([group, status]) => <p key={group}>{group}: {status.status === 'unavailable' ? 'YouTube chưa cung cấp dữ liệu cho kênh/khoảng thời gian này.' : 'Không thể tải nhóm số liệu này; các nhóm khác vẫn được hiển thị.'}</p>)}
            </aside>}

            <GrowthPlanPanel channelId={channel.id} />
            <ReviewV2Panel channelId={channel.id} target="channel" onOpenVideo={setSelectedVideoId} />

            <section className={styles.panel} aria-labelledby="trend-heading">
              <div className={styles.panelHeading}><div><h2 id="trend-heading">Xu hướng 28 ngày</h2><p>So sánh 28 ngày gần nhất với 28 ngày trước đó.</p></div><Button size="sm" onClick={() => void overviewQuery.refetch()}>Làm mới dữ liệu</Button></div>
              <div className={styles.trendTiles}>
                <TrendTile title="Lượt xem" value={dailyAvailable ? overview.trend.views.current : null} change={overview.trend.views.changePercent} />
                <TrendTile title="Thời gian xem" value={dailyAvailable ? overview.trend.watchMinutes.current / 60 : null} change={overview.trend.watchMinutes.changePercent} suffix=" giờ" />
                <TrendTile title="Người đăng ký ròng" value={dailyAvailable ? overview.trend.subscribers.current : null} change={overview.trend.subscribers.changePercent} />
              </div>
              {dailyAvailable && overview.trend.tooFewData && <p className={styles.warning}>Quá ít dữ liệu: ít nhất một cửa sổ có dưới 100 lượt xem. Phần trăm thay đổi có thể nhiễu.</p>}
              <div className={styles.chartGrid}>
                <DailyChart rows={daily.map(({ date, views }) => ({ date, value: views }))} metric="views" title="Lượt xem mỗi ngày" valueFormat={(value) => NUMBER.format(value)} />
                <DailyChart rows={daily.map(({ date, watchHours }) => ({ date, value: watchHours }))} metric="watchHours" title="Giờ xem mỗi ngày" valueFormat={(value) => `${NUMBER.format(value)} giờ`} />
              </div>
            </section>

            <ThresholdPanel health={overview.health} thresholds={overview.thresholds} />

            <section className={styles.panel} aria-labelledby="videos-heading">
              <div className={styles.panelHeading}><div><h2 id="videos-heading">Video đã đồng bộ</h2><p>CTR chưa được cung cấp trong giai đoạn này.</p></div></div>
              <div className={styles.videoToolbar}>
                <label>Tìm video<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tiêu đề" /></label>
                <label>Định dạng<select value={videoKind} onChange={(event) => setVideoKind(event.target.value as VideoKind)}><option value="all">Tất cả</option><option value="long">Video dài</option><option value="short">Shorts</option></select></label>
                <label>Cửa sổ<select value={windowKey} onChange={(event) => setWindowKey(event.target.value as WindowKey)}><option value="28d">28 ngày</option><option value="90d">90 ngày</option><option value="365d">365 ngày</option><option value="lifetime">Toàn thời gian</option></select></label>
                <label>Sắp xếp<select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="viewsPerDay">Lượt xem/ngày</option><option value="averageViewPercentage">Tỷ lệ xem TB</option><option value="clickThroughRate">CTR</option><option value="subscribersPerThousandViews">Đăng ký / 1.000 lượt xem</option></select></label>
              </div>
              {videosQuery.isLoading ? <p className={styles.emptyInline} role="status">Đang tải danh sách video…</p>
                : videosQuery.error ? <div className={styles.errorBox} role="alert"><p>{videosQuery.error instanceof Error ? videosQuery.error.message : 'Không tải được danh sách video.'}</p><Button onClick={() => void videosQuery.refetch()}>Thử lại</Button></div>
                  : videos.length === 0 ? <p className={styles.emptyInline}>Chưa có video phù hợp bộ lọc hoặc chưa đồng bộ video nào.</p>
                    : <div className={styles.tableWrap}><table className={styles.videoTable}><thead><tr><th>Video</th><th>Lượt xem/ngày</th><th>Tỷ lệ xem TB</th><th>CTR</th><th>Đăng ký / 1.000 lượt xem</th><th>Dự án liên kết</th></tr></thead><tbody>
                      {videos.map((video: YoutubeVideoListItem) => <tr key={video.videoId}>
                        <td><button className={styles.videoTitle} onClick={() => setSelectedVideoId(video.videoId)}>{video.title}</button><small>{video.isShort ? 'Shorts' : 'Video dài'} · {maybeDate(video.publishedAt)}</small></td>
                        <td>{formatYoutubeMetric(video.ranking.viewsPerDay).text}</td>
                        <td title={video.ranking.averageViewPercentage === null ? YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP : undefined}>{formatYoutubeMetric(video.ranking.averageViewPercentage, { style: 'percent' }).text}</td>
                        <td title={YOUTUBE_CTR_UNAVAILABLE_TOOLTIP}>Chưa có dữ liệu</td>
                        <td title={video.ranking.subscribersPerThousandViews === null ? YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP : undefined}>{formatYoutubeMetric(video.ranking.subscribersPerThousandViews).text}</td>
                        <td>{video.linkedProject ? <><strong>{video.linkedProject.title}</strong><small>{video.linkedProject.scriptPresetId ?? '—'} · {video.linkedProject.visualStylePresetId ?? '—'}</small></> : <span className={styles.muted}>Chưa liên kết</span>}</td>
                      </tr>)}
                    </tbody></table></div>}
            </section>

            <section className={styles.panel} aria-labelledby="cohorts-heading">
              <div className={styles.panelHeading}><div><h2 id="cohorts-heading">So sánh nhóm video</h2><p>Mô tả trung vị theo đặc điểm có thể kiểm soát; không suy ra quan hệ nhân quả.</p></div></div>
              {overview.cohorts.length === 0 ? <p className={styles.emptyInline}>Chưa đủ video để tạo nhóm so sánh.</p> : <div className={styles.tableWrap}><table className={styles.cohortTable}><thead><tr><th>Nhóm</th><th>Đặc điểm</th><th>n</th><th>Trung vị lượt xem/ngày</th><th>Trung vị tỷ lệ xem</th></tr></thead><tbody>{overview.cohorts.map((cohort) => <tr key={cohort.key}><td>{cohort.dimension}</td><td>{cohort.label}{cohort.sampleWarning && <span className={styles.smallSample}>{cohort.sampleWarning}</span>}</td><td>{cohort.n}</td><td>{formatYoutubeMetric(cohort.medianViewsPerDay).text}</td><td title={cohort.medianAverageViewPercentage === null ? YOUTUBE_METRIC_UNAVAILABLE_TOOLTIP : undefined}>{formatYoutubeMetric(cohort.medianAverageViewPercentage, { style: 'percent' }).text}</td></tr>)}</tbody></table></div>}
            </section>

            <section className={styles.panel} aria-labelledby="suggestions-heading">
              <div className={styles.panelHeading}><div><h2 id="suggestions-heading">Gợi ý liên kết</h2><p>Gợi ý dựa trên tiêu đề SEO đã chọn và ngày đăng. Bạn xác nhận trước khi lưu.</p></div></div>
              {linkNotice && <p className={styles.message} role="status">{linkNotice}</p>}
              {suggestionsQuery.isLoading ? <p className={styles.emptyInline} role="status">Đang tìm dự án và video có thể khớp…</p>
                : suggestionsQuery.error ? <p className={styles.error} role="alert">Không tải được gợi ý liên kết.</p>
                  : suggestions.length === 0 ? <p className={styles.emptyInline}>Chưa có gợi ý. Có thể liên kết video trực tiếp từ chi tiết video.</p>
                    : <div className={styles.suggestionList}>{suggestions.map((suggestion) => {
                      const key = `${suggestion.projectId}:${suggestion.videoId}`;
                      const alreadyLinked = !unlinkedProjects.some((project) => project.id === suggestion.projectId);
                      return <article className={styles.suggestion} key={key}>
                        <div><strong>{suggestion.projectTitle}</strong><span>{suggestion.chosenSeoTitle}</span><span>↔ {suggestion.videoTitle}</span><small>{suggestion.reasons.join(' · ') || 'Ngày đăng gần với ngày tạo dự án.'}</small></div>
                        <div className={styles.suggestionActions}><Button size="sm" variant="amber" onClick={() => void confirmSuggestion(suggestion.projectId, suggestion.videoId)} disabled={alreadyLinked}>Xác nhận</Button><Button size="sm" onClick={() => setDismissedSuggestions((current) => new Set(current).add(key))}>Bỏ qua</Button></div>
                      </article>;
                    })}</div>}
            </section>

          </>}
      <VideoDetailDrawer channelId={channel.id} videoId={selectedVideoId} onClose={() => setSelectedVideoId(null)} onOpenVideo={setSelectedVideoId} />
    </main>
  );
}
