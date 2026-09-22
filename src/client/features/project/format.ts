import type { ProjectDetail, ProjectStatus } from '../../../contracts/project';

/** Label + Badge tone per status, copied from docs/prototypes/khoi-tao-du-an/app.js (STATUS). */
export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: 'muted' | 'indigo' | 'amber' | 'green' }> = {
  draft: { label: 'Nháp', tone: 'muted' },
  script: { label: 'Đã có kịch bản', tone: 'indigo' },
  assets: { label: 'Đã có asset', tone: 'amber' },
  rendered: { label: 'Đã render', tone: 'green' },
};

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${sec} giây`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} phút ${s} giây` : `${m} phút`;
}

const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });

/** "vừa xong" / "3 phút trước" / ... , same buckets as the prototype's relTime(). */
export function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  const diff = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return 'vừa xong';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString('vi-VN');
}

export function projectMeta(p: { scenesCount: number | null; durationSec: number | null; status: ProjectStatus }): string {
  return p.scenesCount != null ? `${p.scenesCount} cảnh • ${p.durationSec}s` : PROJECT_STATUS_META[p.status].label;
}

/** Same "N cảnh • Ns" / status-label rule as projectMeta(), but from a full ProjectDetail (has `scenes`, not precomputed counts). */
export function projectDetailMeta(detail: ProjectDetail): string {
  const scenesCount = detail.scenes.length > 0 ? detail.scenes.length : null;
  const durationSec = scenesCount !== null ? detail.scenes.reduce((sum, s) => sum + s.durationSec, 0) : null;
  return projectMeta({ scenesCount, durationSec, status: detail.status });
}
