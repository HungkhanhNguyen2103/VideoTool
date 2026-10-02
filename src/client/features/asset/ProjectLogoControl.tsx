import { useRef } from 'react';
import type { FileSummary } from '../../../contracts/file';
import type { ProjectDetail } from '../../../contracts/project';
import { Button } from '../../shared/ui/Button';
import { toast } from '../../shared/ui/toast-store';
import * as api from './api';
import styles from './ProjectLogoControl.module.css';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type ProjectLogoControlProps = {
  project: ProjectDetail;
  logoFile?: FileSummary;
  busy: string | null;
  setBusy: (value: string | null) => void;
  refresh: () => Promise<void>;
};

export function ProjectLogoControl({ project, logoFile, busy, setBusy, refresh }: ProjectLogoControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  async function upload(file: File): Promise<void> {
    if (!LOGO_MIME_TYPES.has(file.type)) {
      toast('Logo phải là PNG, JPEG hoặc WebP.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast('Logo không được vượt quá 5 MB.');
      return;
    }
    try {
      setBusy('logo');
      await api.uploadProjectLogo(project.id, file);
      await refresh();
      toast('Đã cập nhật logo.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể cập nhật logo.');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(): Promise<void> {
    try {
      setBusy('logo');
      await api.removeProjectLogo(project.id);
      await refresh();
      toast('Đã xoá logo.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể xoá logo.');
    } finally {
      setBusy(null);
    }
  }

  const preview = logoFile && LOGO_MIME_TYPES.has(logoFile.mimeType)
    ? <img src={api.fileUrlForSummary(logoFile)} alt="Logo video" />
    : <span>Chưa có logo</span>;

  return (
    <div className={styles.block}>
      <div className={styles.preview}>{preview}</div>
      <div className={styles.copy}><strong>Logo video</strong><span className={styles.muted}>Watermark mờ ở góc phải dưới</span></div>
      <div className={styles.actions}>
        <input ref={inputRef} className={styles.hiddenInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <Button size="sm" disabled={busy !== null} onClick={() => inputRef.current?.click()}>{project.logoFileId ? 'Đổi logo' : 'Tải logo lên'}</Button>
        {project.logoFileId && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void remove()}>Xoá logo</Button>}
      </div>
      {project.renderEngine === 'ffmpeg' && <span className={styles.hint}>Chỉ áp dụng cho Remotion.</span>}
    </div>
  );
}
