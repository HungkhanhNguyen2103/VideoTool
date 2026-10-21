import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Channel } from '../../../../contracts/channel';
import { Button } from '../../../shared/ui/Button';
import { useJobProgress } from '../../../shared/hooks/use-job-progress';
import { useYoutubeActiveSync, useYoutubeConnection, invalidateYoutubeChannelQueries, youtubeConnectionKey } from '../hooks';
import { beginYoutubeConnection, disconnectYoutube, getYoutubeConnection, startYoutubeSync } from '../api';
import { isTrustedYoutubeOauthMessage, isYoutubeSyncActive, youtubeConnectionLabel, youtubeConnectionState, youtubeSyncMessage } from '../youtube-view';
import styles from './ChannelYoutubeControls.module.css';

type Props = { channel: Channel };

function SetupGuide() {
  return (
    <details className={styles.setupGuide}>
      <summary>Hướng dẫn cấu hình Google Cloud</summary>
      <ol>
        <li>Tạo Google Cloud project, bật YouTube Data API v3 và YouTube Analytics API.</li>
        <li>Tạo màn hình đồng ý OAuth loại External, thêm tài khoản Google của Hung làm test user và chọn đúng hai quyền chỉ đọc YouTube.</li>
        <li>Tạo OAuth client loại Web application với callback <code>http://localhost:3000/api/youtube/oauth/callback</code> và <code>http://127.0.0.1:3000/api/youtube/oauth/callback</code>.</li>
        <li>Đặt <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code> và <code>YOUTUBE_TOKEN_ENCRYPTION_KEY</code> trong <code>.env</code>.</li>
        <li>Chọn <strong>In production</strong> để tránh refresh token hết hạn sau 7 ngày ở Testing. Google có thể hiện cảnh báo app chưa xác minh; với mục đích cá nhân, Hung chỉ nên tiếp tục cho tài khoản của mình. App External chưa xác minh bị giới hạn 100 người dùng mới trong toàn bộ vòng đời.</li>
      </ol>
      <p>Trạng thái hiện tại của app: Testing, với một test user. Hung cần tự chuyển trạng thái xuất bản sang In production trong Google Cloud.</p>
      <a href="https://support.google.com/cloud/answer/15549945" target="_blank" rel="noreferrer">Quy tắc màn hình đồng ý OAuth của Google</a>
    </details>
  );
}

export function ChannelYoutubeControls({ channel }: Props) {
  const queryClient = useQueryClient();
  const connectionQuery = useYoutubeConnection(channel.id, channel.youtube);
  const activeJobQuery = useYoutubeActiveSync(channel.id, connectionQuery.data?.connected ?? false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupMonitorRef = useRef<number | null>(null);
  const progress = useJobProgress(jobId);
  const connection = connectionQuery.data;
  const state = youtubeConnectionState(connection);
  const syncActive = isYoutubeSyncActive(jobId, progress);

  useEffect(() => {
    if (activeJobQuery.data?.jobId) setJobId(activeJobQuery.data.jobId);
  }, [activeJobQuery.data?.jobId]);

  useEffect(() => {
    if (!jobId || !progress || !['done', 'failed', 'cancelled'].includes(progress.status)) return;
    const resultMessage = youtubeSyncMessage(progress);
    if (resultMessage) setMessage(resultMessage);
    if (progress.status === 'failed') setError(resultMessage);
    void invalidateYoutubeChannelQueries(queryClient, channel.id);
    void queryClient.invalidateQueries({ queryKey: ['channels'] });
    const timer = window.setTimeout(() => setJobId(null), 5000);
    return () => window.clearTimeout(timer);
  }, [channel.id, jobId, progress?.status, progress?.error, queryClient]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isTrustedYoutubeOauthMessage(event, popupRef.current) || !event.data || typeof event.data !== 'object') return;
      const payload = event.data as { type?: unknown; success?: unknown };
      if (payload.type !== 'youtube-oauth-finished') return;
      if (popupMonitorRef.current !== null) window.clearInterval(popupMonitorRef.current);
      popupMonitorRef.current = null;
      popupRef.current = null;
      if (payload.success !== true) {
        setOauthPending(false);
        setError('Google không hoàn tất kết nối. Hãy kiểm tra quyền đọc YouTube rồi thử lại.');
        return;
      }
      setMessage('Đã xác nhận Google. Đang kiểm tra kênh được liên kết…');
      void pollForConnection();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (popupMonitorRef.current !== null) window.clearInterval(popupMonitorRef.current);
    };
  }, [channel.id, queryClient]);

  async function pollForConnection() {
    setOauthPending(true);
    setError(null);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const latest = await getYoutubeConnection(channel.id);
        queryClient.setQueryData(youtubeConnectionKey(channel.id), latest);
        if (latest.connected) {
          await queryClient.invalidateQueries({ queryKey: ['channels'] });
          await invalidateYoutubeChannelQueries(queryClient, channel.id);
          setMessage(`Đã kết nối ${latest.title ?? 'kênh YouTube'}.`);
          setOauthPending(false);
          return;
        }
      } catch {
        // The callback may finish before Mongo reflects the new channel; retry until the bounded deadline.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    setOauthPending(false);
    setError('Chưa nhận được trạng thái kênh sau 2 phút. Hãy làm mới danh sách kênh để kiểm tra.');
  }

  async function connect() {
    setMessage(null);
    setError(null);
    const popup = window.open('about:blank', 'youtube-oauth', 'popup,width=620,height=760');
    if (!popup) {
      setError('Trình duyệt đã chặn cửa sổ Google. Hãy cho phép popup rồi thử lại.');
      return;
    }
    popupRef.current = popup;
    setOauthPending(true);
    popupMonitorRef.current = window.setInterval(() => {
      if (popup.closed) {
        if (popupMonitorRef.current !== null) window.clearInterval(popupMonitorRef.current);
        popupMonitorRef.current = null;
        popupRef.current = null;
        setOauthPending(false);
      }
    }, 500);
    try {
      const { authorizationUrl } = await beginYoutubeConnection(channel.id);
      popup.location.href = authorizationUrl;
    } catch (caught) {
      popup.close();
      if (popupMonitorRef.current !== null) window.clearInterval(popupMonitorRef.current);
      popupMonitorRef.current = null;
      popupRef.current = null;
      setOauthPending(false);
      setError(caught instanceof Error ? caught.message : 'Không thể bắt đầu kết nối Google.');
    }
  }

  async function syncNow() {
    setError(null);
    setMessage(null);
    try {
      const started = await startYoutubeSync(channel.id);
      setJobId(started.jobId);
      await queryClient.invalidateQueries({ queryKey: ['youtube', 'active-sync', channel.id] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể xếp hàng đồng bộ YouTube.');
    }
  }

  async function disconnect() {
    if (!window.confirm('Ngắt kết nối YouTube? Dữ liệu đã đồng bộ sẽ được giữ lại trên máy.')) return;
    setError(null);
    setMessage(null);
    try {
      await disconnectYoutube(channel.id);
      await invalidateYoutubeChannelQueries(queryClient, channel.id);
      await queryClient.invalidateQueries({ queryKey: ['channels'] });
      setJobId(null);
      setMessage('Đã ngắt kết nối YouTube. Dữ liệu đã đồng bộ vẫn được giữ lại.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể ngắt kết nối YouTube.');
    }
  }

  return (
    <section className={styles.panel} aria-label={`Kết nối YouTube: ${channel.name}`}>
      <div className={styles.heading}>
        <strong>Kết nối YouTube</strong>
        <span className={`${styles.badge} ${styles[state]}`}>{youtubeConnectionLabel(state)}</span>
      </div>
      <p className={styles.promise}>Chỉ đọc số liệu. Không đăng hay sửa gì trên kênh của bạn.</p>
      {connection?.connected && (
        <div className={styles.channelIdentity}>
          {connection.thumbnailUrl && <img src={connection.thumbnailUrl} alt="" />}
          <span><strong>{connection.title}</strong>{connection.handle && <small>{connection.handle}</small>}</span>
        </div>
      )}
      {connection?.lastSyncAt && <p className={styles.muted}>Đồng bộ gần nhất: {new Date(connection.lastSyncAt).toLocaleString('vi-VN')}</p>}
      {connection?.lastSyncError && <p className={styles.error} role="alert">{connection.lastSyncError}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.message} role="status">{message}</p>}
      {oauthPending && <p className={styles.muted} role="status">Đang chờ Google xác nhận. Hệ thống sẽ kiểm tra kết nối trong tối đa 2 phút.</p>}
      {syncActive && <div className={styles.progress}><progress max={100} value={progress?.progress ?? 0} /><span>{progress?.progress ?? 0}%</span></div>}
      {state === 'not-configured' ? <SetupGuide /> : (
        <div className={styles.actions}>
          {!connection?.connected && <Button size="sm" variant="amber" onClick={() => void connect()} disabled={oauthPending}>{state === 'reconnect' ? 'Kết nối lại YouTube' : 'Kết nối YouTube'}</Button>}
          {connection?.connected && <>
            <Button size="sm" variant="amber" onClick={() => void syncNow()} disabled={syncActive || oauthPending}>{syncActive ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}</Button>
            <Link className={styles.analyticsLink} to={`/channels/${encodeURIComponent(channel.id)}/analytics`}>Phân tích kênh</Link>
            <Button size="sm" onClick={() => void disconnect()} disabled={syncActive}>Ngắt kết nối</Button>
          </>}
        </div>
      )}
    </section>
  );
}
