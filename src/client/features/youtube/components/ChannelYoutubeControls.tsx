import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Channel } from '../../../../contracts/channel';
import type { YoutubeProfileField } from '../../../../contracts/youtube';
import { Button } from '../../../shared/ui/Button';
import { useJobProgress } from '../../../shared/hooks/use-job-progress';
import { useYoutubeActiveSync, useYoutubeConnection, invalidateYoutubeChannelQueries, useRefreshYoutubeProfile, youtubeConnectionKey } from '../hooks';
import { beginYoutubeConnection, disconnectYoutube, getYoutubeConnection, startYoutubeSync } from '../api';
import { isYoutubeSyncActive, youtubeConnectionLabel, youtubeConnectionState, youtubeSyncMessage } from '../youtube-view';
import { useYoutubeOauthPopup, type YoutubeOauthFinishedMessage } from '../use-youtube-oauth-popup';
import styles from './ChannelYoutubeControls.module.css';

type Props = {
  channel: Channel;
  beforeProfileRefresh?: () => boolean | Promise<boolean>;
  onProfileRefreshed?: () => void | Promise<void>;
};

const PROFILE_FIELD_LABELS: Record<YoutubeProfileField, string> = {
  name: 'Tên kênh',
  handle: 'Handle',
  description: 'Mô tả',
  language: 'Ngôn ngữ',
};

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

export function ChannelYoutubeControls({ channel, beforeProfileRefresh, onProfileRefreshed }: Props) {
  const queryClient = useQueryClient();
  const connectionQuery = useYoutubeConnection(channel.id, channel.youtube);
  const activeJobQuery = useYoutubeActiveSync(channel.id, connectionQuery.data?.connected ?? false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [connectionCheckPending, setConnectionCheckPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overwriteDialogRef = useRef<HTMLDialogElement>(null);
  const [overwriteFields, setOverwriteFields] = useState<YoutubeProfileField[]>(['name', 'handle', 'description', 'language']);
  const refreshMutation = useRefreshYoutubeProfile();
  const progress = useJobProgress(jobId);
  const connection = connectionQuery.data;
  const state = youtubeConnectionState(connection);
  const syncActive = isYoutubeSyncActive(jobId, progress);
  const { pending: popupPending, openPopup } = useYoutubeOauthPopup((payload: YoutubeOauthFinishedMessage) => {
    if (!payload.success) {
      setConnectionCheckPending(false);
      setError('Google không hoàn tất kết nối. Hãy kiểm tra quyền đọc YouTube rồi thử lại.');
      return;
    }
    setMessage('Đã xác nhận Google. Đang kiểm tra kênh được liên kết…');
    void pollForConnection();
  });
  const oauthPending = popupPending || connectionCheckPending;

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

  async function pollForConnection() {
    setConnectionCheckPending(true);
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
          setConnectionCheckPending(false);
          return;
        }
      } catch {
        // The callback may finish before Mongo reflects the new channel; retry until the bounded deadline.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    setConnectionCheckPending(false);
    setError('Chưa nhận được trạng thái kênh sau 2 phút. Hãy làm mới danh sách kênh để kiểm tra.');
  }

  async function connect() {
    setMessage(null);
    setError(null);
    try {
      await openPopup(() => beginYoutubeConnection(channel.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể bắt đầu kết nối Google.');
    }
  }

  async function refreshProfile(overwrite: boolean, fields?: YoutubeProfileField[]) {
    if (beforeProfileRefresh && !(await beforeProfileRefresh())) return;
    setError(null);
    setMessage(null);
    try {
      const result = await refreshMutation.mutateAsync({ channelId: channel.id, input: { overwrite, ...(fields ? { fields } : {}) } });
      const updated = result.updated.map((field) => PROFILE_FIELD_LABELS[field]);
      setMessage(updated.length ? `Đã cập nhật thông tin hồ sơ từ YouTube: ${updated.join(', ')}.` : 'Không có trường hồ sơ nào cần cập nhật.');
      overwriteDialogRef.current?.close();
      await onProfileRefreshed?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể cập nhật hồ sơ từ YouTube.');
    }
  }

  function openOverwriteDialog() {
    setOverwriteFields(['name', 'handle', 'description', 'language']);
    overwriteDialogRef.current?.showModal();
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
            <Button size="sm" onClick={() => void refreshProfile(false)} disabled={refreshMutation.isPending || oauthPending}>{refreshMutation.isPending ? 'Đang cập nhật…' : 'Cập nhật thông tin từ YouTube'}</Button>
            <Button size="sm" onClick={openOverwriteDialog} disabled={refreshMutation.isPending || oauthPending}>Ghi đè từ YouTube…</Button>
            <Button size="sm" onClick={() => void disconnect()} disabled={syncActive}>Ngắt kết nối</Button>
          </>}
        </div>
      )}
      <dialog ref={overwriteDialogRef} className={styles.overwriteDialog} aria-labelledby={`youtube-overwrite-title-${channel.id}`}>
        <form method="dialog" className={styles.overwriteForm} onSubmit={(event) => { event.preventDefault(); void refreshProfile(true, overwriteFields); }}>
          <h3 id={`youtube-overwrite-title-${channel.id}`}>Ghi đè trường hồ sơ từ YouTube</h3>
          <p>Chọn các trường được phép ghi đè.</p>
          {(Object.keys(PROFILE_FIELD_LABELS) as YoutubeProfileField[]).map((field) => (
            <label key={field}><input type="checkbox" checked={overwriteFields.includes(field)} onChange={(event) => setOverwriteFields((current) => event.target.checked ? [...current, field] : current.filter((value) => value !== field))} /> {PROFILE_FIELD_LABELS[field]}</label>
          ))}
          <div className={styles.actions}>
            <Button type="button" size="sm" onClick={() => overwriteDialogRef.current?.close()}>Hủy</Button>
            <Button type="submit" size="sm" variant="amber" disabled={overwriteFields.length === 0 || refreshMutation.isPending}>{refreshMutation.isPending ? 'Đang cập nhật…' : 'Ghi đè trường đã chọn'}</Button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
