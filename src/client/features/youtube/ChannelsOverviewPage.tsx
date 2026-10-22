import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { YoutubeChannelOverviewRow } from '../../../contracts/youtube-overview';
import { Button } from '../../shared/ui/Button';
import { useJobProgress } from '../../shared/hooks/use-job-progress';
import { ChannelManagerDialog } from '../channel/components/ChannelManagerDialog';
import { beginYoutubeConnection, beginYoutubeImport, getYoutubeConnection, startYoutubeSync } from './api';
import {
  invalidateYoutubeChannelsOverviewQueries,
  useSyncAllYoutubeChannels,
  useYoutubeChannelsOverview,
  useYoutubeSetupStatus,
  youtubeConnectionKey,
} from './hooks';
import { useYoutubeOauthPopup, type YoutubeOauthFinishedMessage } from './use-youtube-oauth-popup';
import { youtubeImportResultSummary } from './youtube-view';
import { growthStageLabel, growthVerdictLabel } from './growth-plan-view';
import {
  CHANNEL_OVERVIEW_TOTALS_CAPTION,
  channelOverviewConnectionLabel,
  channelOverviewConnectionState,
  formatOverviewHours,
  formatOverviewNumber,
  sortChannelOverview,
  type YoutubeChannelsOverviewSort,
  type YoutubeOverviewMetric,
  youtubeChannelChangeText,
  youtubeSyncAllResultSummary,
} from './channels-overview-view';
import styles from './ChannelsOverviewPage.module.css';

const DATE_TIME = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });

function maybeDate(value: string | undefined): string {
  return value ? DATE_TIME.format(new Date(value)) : 'Chưa đồng bộ';
}

function Metric({ row, metric, title, value }: { row: YoutubeChannelOverviewRow; metric: YoutubeOverviewMetric; title: string; value: string }) {
  return <div className={styles.metric}>
    <span>{title}</span>
    <strong>{value}</strong>
    <small>{youtubeChannelChangeText(row, metric)} so với 28 ngày trước</small>
  </div>;
}

function progressValue(health: YoutubeChannelOverviewRow['health']['current']['entryTier']): number | null {
  if (health.subscribersProgress === null) return null;
  const activity = [health.watchHoursProgress, health.shortViewsProgress].filter((value): value is number => value !== null);
  if (activity.length === 0) return null;
  return Math.min(health.subscribersProgress, Math.max(...activity));
}

function ProgressRow({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return <div className={styles.progressRow}>
    <div><span>{label}</span><small>{detail}</small></div>
    <div className={styles.progressTrack} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      {value !== null && <span style={{ width: `${Math.round(value * 100)}%` }} />}
    </div>
    <small>{value === null ? 'Chưa có dữ liệu' : `${Math.round(value * 100)}%`}</small>
  </div>;
}

function ChannelCard({ row, onRefresh }: { row: YoutubeChannelOverviewRow; onRefresh: (channelId: string) => Promise<void> }) {
  const queryClient = useQueryClient();
  const [jobIdOverride, setJobIdOverride] = useState<string | null>(null);
  const [connectionPending, setConnectionPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handledTerminalJob = useRef<string | null>(null);
  const activeJobId = row.activeSyncJobId ?? jobIdOverride;
  const progress = useJobProgress(activeJobId);
  const syncing = Boolean(activeJobId) && (!progress || progress.status === 'queued' || progress.status === 'running');
  const state = channelOverviewConnectionState(row.connection);
  const { pending: popupPending, openPopup } = useYoutubeOauthPopup((payload: YoutubeOauthFinishedMessage) => {
    if (!payload.success) {
      setConnectionPending(false);
      setError('Google không hoàn tất kết nối. Hãy thử lại.');
      return;
    }
    void waitForConnection();
  });

  useEffect(() => {
    if (!activeJobId || !progress || !['done', 'failed', 'cancelled'].includes(progress.status) || handledTerminalJob.current === activeJobId) return;
    handledTerminalJob.current = activeJobId;
    setMessage(progress.status === 'done' ? 'Đồng bộ YouTube hoàn tất.' : progress.status === 'cancelled' ? 'Đồng bộ YouTube đã bị hủy.' : progress.error || 'Đồng bộ YouTube không thành công.');
    if (progress.status === 'failed') setError(progress.error || 'Đồng bộ YouTube không thành công.');
    setJobIdOverride(null);
    void onRefresh(row.channelId);
  }, [activeJobId, onRefresh, progress, row.channelId]);

  async function waitForConnection() {
    setConnectionPending(true);
    setError(null);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const latest = await getYoutubeConnection(row.channelId);
        queryClient.setQueryData(youtubeConnectionKey(row.channelId), latest);
        if (latest.connected) {
          await invalidateYoutubeChannelsOverviewQueries(queryClient, [row.channelId]);
          setConnectionPending(false);
          setMessage(`Đã kết nối ${latest.title ?? 'kênh YouTube'}.`);
          return;
        }
      } catch {
        // The OAuth callback and credential write can arrive in either order.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    setConnectionPending(false);
    setError('Chưa nhận được trạng thái kênh sau 2 phút. Hãy làm mới để kiểm tra.');
  }

  async function connect() {
    setMessage(null);
    setError(null);
    try {
      await openPopup(() => beginYoutubeConnection(row.channelId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể bắt đầu kết nối Google.');
    }
  }

  async function sync() {
    setMessage(null);
    setError(null);
    try {
      const result = await startYoutubeSync(row.channelId);
      setJobIdOverride(result.jobId);
      await onRefresh(row.channelId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể xếp hàng đồng bộ.');
    }
  }

  const entry = row.health.current.entryTier;
  const ads = row.health.current.ads;
  const cardStateClass = styles[state];
  return <article className={styles.channelCard}>
    <header className={styles.cardHeader}>
      <div className={styles.identity}>
        {row.connection.thumbnailUrl ? <img className={styles.avatar} src={row.connection.thumbnailUrl} alt="" /> : <span className={styles.avatarFallback}>{[...row.name][0]?.toLocaleUpperCase('vi') ?? '?'}</span>}
        <div className={styles.identityText}><h2 title={row.name}>{row.name}</h2><p>{row.handle ?? row.connection.handle ?? ' '}</p></div>
      </div>
      <span className={`${styles.badge} ${cardStateClass}`}>{channelOverviewConnectionLabel(state)}</span>
    </header>

    <div className={styles.growthBadges} aria-label="Kế hoạch tăng trưởng">
      <span>{growthStageLabel(row.stage)}</span>
      <span className={row.verdict === 'change_one_variable' || row.verdict === 'consider_stop' ? styles.growthWarning : ''}>{growthVerdictLabel(row.verdict)}</span>
    </div>

    <div className={styles.counts}>
      <span><strong>{formatOverviewNumber(row.subscriberCount)}</strong> người đăng ký</span>
      <span><strong>{row.videoCount}</strong> video · {row.longCount} dài · {row.shortCount} Shorts</span>
    </div>

    <div className={styles.metrics}>
      <Metric row={row} metric="views" title="Lượt xem · 28 ngày" value={formatOverviewNumber(row.last28.views)} />
      <Metric row={row} metric="watchHours" title="Giờ xem · 28 ngày" value={formatOverviewHours(row.last28.estimatedMinutesWatched === null ? null : row.last28.estimatedMinutesWatched / 60)} />
      <Metric row={row} metric="subscribersGained" title="Đăng ký mới · 28 ngày" value={formatOverviewNumber(row.last28.subscribersGained)} />
    </div>

    <section className={styles.health} aria-label="Tiến độ kiếm tiền tham khảo">
      <h3>Mốc tham khảo</h3>
      <ProgressRow label="Mốc sớm" value={progressValue(entry)} detail={`${formatOverviewNumber(entry.subscribers)} người đăng ký · ${formatOverviewNumber(entry.longWatchHours)} giờ hoặc ${formatOverviewNumber(entry.shortViews)} lượt Shorts`} />
      <ProgressRow label="Quảng cáo" value={progressValue(ads)} detail={`${formatOverviewNumber(ads.subscribers)} người đăng ký · ${formatOverviewNumber(ads.longWatchHours)} giờ hoặc ${formatOverviewNumber(ads.shortViews)} lượt Shorts`} />
    </section>

    {row.topVideo && <p className={styles.topVideo}><span>Video nổi bật</span><strong title={row.topVideo.title}>{row.topVideo.title}</strong><small>{formatOverviewNumber(row.topVideo.viewsPerDay)} lượt xem/ngày</small></p>}
    <div className={styles.syncMeta}>
      <span>Đồng bộ gần nhất: {maybeDate(row.connection.lastSyncAt)}</span>
      {row.connection.lastSyncError && <p role="alert">{row.connection.lastSyncError}</p>}
    </div>
    {syncing && <div className={styles.syncProgress} role="status"><span className={styles.spinner} aria-hidden="true" /><span>Đang đồng bộ…</span><progress max={100} value={progress?.progress ?? 0} /><strong>{progress?.progress ?? 0}%</strong></div>}
    {message && <p className={styles.message} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {(popupPending || connectionPending) && <p className={styles.pending} role="status">Đang chờ Google xác nhận kết nối…</p>}

    <footer className={styles.cardActions}>
      <Link className={styles.primaryLink} to={`/channels/${encodeURIComponent(row.channelId)}/analytics`}>Xem phân tích</Link>
      {row.connection.connected ? <Button size="sm" onClick={() => void sync()} disabled={syncing || popupPending}>Đồng bộ</Button> : <Button size="sm" onClick={() => void connect()} disabled={!row.connection.setupConfigured || popupPending || connectionPending}>{row.connection.needsReconnect ? 'Kết nối lại YouTube' : 'Kết nối YouTube'}</Button>}
    </footer>
  </article>;
}

export function ChannelsOverviewPage() {
  const queryClient = useQueryClient();
  const overviewQuery = useYoutubeChannelsOverview();
  const setupQuery = useYoutubeSetupStatus();
  const syncAllMutation = useSyncAllYoutubeChannels();
  const [sort, setSort] = useState<YoutubeChannelsOverviewSort>('views28');
  const [manageChannels, setManageChannels] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { pending: importPending, openPopup: openImportPopup } = useYoutubeOauthPopup((payload: YoutubeOauthFinishedMessage) => {
    if (!payload.success) {
      setActionError('Google không hoàn tất việc thêm kênh. Hãy đăng nhập lại rồi thử.');
      return;
    }
    setActionError(null);
    setNotice(youtubeImportResultSummary({ imported: payload.imported ?? 0, alreadyBound: payload.alreadyBound, failed: payload.failed }));
    void invalidateYoutubeChannelsOverviewQueries(queryClient, payload.profileIds);
  });
  const channels = overviewQuery.data?.channels ?? [];
  const sortedChannels = sortChannelOverview(channels, sort);
  const googleConfigured = setupQuery.data?.configured ?? channels.some((channel) => channel.connection.setupConfigured);
  const eligibleCount = channels.filter((channel) => channel.connection.connected && !channel.activeSyncJobId).length;
  const connectedCount = overviewQuery.data?.totals.channelsConnected ?? 0;

  async function refreshChannel(channelId: string) {
    await invalidateYoutubeChannelsOverviewQueries(queryClient, [channelId]);
  }

  async function syncAll() {
    setNotice(null);
    setActionError(null);
    try {
      const result = await syncAllMutation.mutateAsync();
      setNotice(youtubeSyncAllResultSummary(result.results));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Không thể đồng bộ các kênh.');
    }
  }

  async function importChannels() {
    setNotice(null);
    setActionError(null);
    try {
      await openImportPopup(beginYoutubeImport);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Không thể bắt đầu thêm kênh từ YouTube.');
    }
  }

  return <main className={styles.page}>
    <header className={styles.pageHeader}>
      <div><p className={styles.eyebrow}>YOUTUBE ANALYTICS · CHỈ ĐỌC</p><h1>Phân tích kênh</h1><p>Theo dõi các kênh đã lưu và mở phân tích chi tiết khi cần.</p></div>
      <div className={styles.headerActions}>
        <Button size="sm" variant="amber" onClick={() => void syncAll()} disabled={!googleConfigured || eligibleCount === 0 || syncAllMutation.isPending} busy={syncAllMutation.isPending}>{syncAllMutation.isPending ? 'Đang xếp hàng…' : 'Đồng bộ tất cả'}</Button>
        <Button size="sm" onClick={() => void importChannels()} disabled={!googleConfigured || importPending}>{importPending ? 'Đang chờ Google…' : 'Thêm kênh từ YouTube'}</Button>
        <Button size="sm" onClick={() => setManageChannels(true)}>Quản lý kênh</Button>
      </div>
    </header>

    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {actionError && <p className={styles.errorBanner} role="alert">{actionError}</p>}
    {setupQuery.data && !setupQuery.data.configured && <aside className={styles.setupBanner}><strong>Google OAuth chưa được cấu hình</strong><p>{setupQuery.data.message}</p></aside>}

    {overviewQuery.data && <section className={styles.totals} aria-label="Tổng số liệu các kênh đã kết nối">
      <div className={styles.totalCaption}>{CHANNEL_OVERVIEW_TOTALS_CAPTION} · {connectedCount} kênh</div>
      <article><span>Tổng người đăng ký</span><strong>{formatOverviewNumber(overviewQuery.data.totals.subscriberCount)}</strong></article>
      <article><span>Lượt xem · 28 ngày</span><strong>{formatOverviewNumber(overviewQuery.data.totals.views28)}</strong></article>
      <article><span>Giờ xem · 28 ngày</span><strong>{formatOverviewHours(overviewQuery.data.totals.watchHours28)}</strong></article>
      <article><span>Đăng ký mới · 28 ngày</span><strong>{formatOverviewNumber(overviewQuery.data.totals.subscribersGained28)}</strong></article>
    </section>}

    {overviewQuery.isLoading ? <section className={styles.loadingGrid} role="status" aria-label="Đang tải kênh">{[0, 1, 2].map((item) => <div className={styles.skeleton} key={item} />)}</section>
      : overviewQuery.error ? <section className={styles.errorState} role="alert"><p>{overviewQuery.error instanceof Error ? overviewQuery.error.message : 'Không tải được danh sách kênh.'}</p><Button onClick={() => void overviewQuery.refetch()}>Thử lại</Button></section>
        : channels.length === 0 ? <section className={styles.emptyState}><h2>Chưa có hồ sơ kênh</h2><p>Chưa có hồ sơ kênh. Bấm Thêm kênh từ YouTube hoặc Quản lý kênh để tạo.</p><div><Button variant="amber" onClick={() => void importChannels()} disabled={!googleConfigured || importPending}>Thêm kênh từ YouTube</Button><Button onClick={() => setManageChannels(true)}>Quản lý kênh</Button></div></section>
          : <>
            {connectedCount === 0 && <aside className={styles.disconnectedBanner}>Chưa có kênh YouTube đang kết nối. Kết nối một kênh để bắt đầu xem số liệu và đồng bộ.</aside>}
            <div className={styles.listHeader}><div><h2>Các kênh của bạn</h2><p>{channels.length} hồ sơ kênh</p></div><label>Sắp xếp<select value={sort} onChange={(event) => setSort(event.target.value as YoutubeChannelsOverviewSort)}><option value="views28">Lượt xem 28 ngày</option><option value="subscribers">Người đăng ký</option><option value="name">Tên kênh</option><option value="lastSync">Đồng bộ gần nhất</option></select></label></div>
            <section className={styles.channelGrid} aria-label="Danh sách kênh">
              {sortedChannels.map((row) => <ChannelCard key={row.channelId} row={row} onRefresh={refreshChannel} />)}
            </section>
          </>}

    {manageChannels && <ChannelManagerDialog open prefill={null} onClose={() => { setManageChannels(false); void invalidateYoutubeChannelsOverviewQueries(queryClient); }} />}
  </main>;
}
