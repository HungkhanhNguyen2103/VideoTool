import type { ChangeEvent } from 'react';
import type { FileSummary } from '../../../../contracts/file';
import type { SeoPackage, SeoPatch } from '../../../../contracts/seo';
import { SEO_THUMBNAIL_HEIGHT, SEO_THUMBNAIL_MAX_BYTES, SEO_THUMBNAIL_WIDTH } from '../../../../contracts/seo';
import { thumbnailTextStatus } from '../../../../contracts/seo-format';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast-store';
import { fileUrlForSummary } from '../../asset/api';
import styles from '../SeoPage.module.css';

type Props = { seo: SeoPackage; thumbnailFile?: FileSummary; busy: boolean; onPatch: (patch: SeoPatch) => void; onRegenerate: () => void; onUpload: (file: File) => void; onRemove: () => void };

/** Copy a thumbnail image prompt so it can be pasted into an external image generator such as Flow. */
export async function copyThumbnailPrompt(
  imagePrompt: string,
  writeText: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text),
  notify: (message: string) => void = toast,
): Promise<boolean> {
  const text = imagePrompt.trim();
  if (!text) { notify('Ý tưởng này chưa có prompt ảnh.'); return false; }
  try { await writeText(text); notify('Đã sao chép prompt ảnh. Dán vào Flow để tạo thumbnail.'); return true; }
  catch { notify('Không thể sao chép prompt. Hãy bôi đen và sao chép thủ công.'); return false; }
}

export function ThumbnailPanel({ seo, thumbnailFile, busy, onPatch, onRegenerate, onUpload, onRemove }: Props) {
  const chosen = seo.thumbnail.ideas.find((idea) => idea.id === seo.thumbnail.chosenIdeaId) ?? null;
  function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ''; }
  return <section className={styles.panel} aria-labelledby="seo-thumbnail-title">
    <div className={styles.panelHead}><div><h2 id="seo-thumbnail-title">Thumbnail</h2><p className={styles.muted}>Tải ảnh cuối cùng lên; ý tưởng và prompt chỉ là gợi ý.</p></div><Button size="sm" onClick={onRegenerate} disabled={busy}>Tạo lại</Button></div>
    <div className={styles.ideaGrid}>{seo.thumbnail.ideas.map((idea) => <div className={styles.ideaItem} key={idea.id}><button className={`${styles.idea} ${idea.id === seo.thumbnail.chosenIdeaId ? styles.selected : ''}`} type="button" onClick={() => onPatch({ thumbnail: { ...seo.thumbnail, chosenIdeaId: idea.id } })}><strong>{idea.overlayText || 'Không chữ'}</strong><span>{idea.concept}</span><small>{idea.imagePrompt}</small></button><Button size="sm" onClick={() => void copyThumbnailPrompt(idea.imagePrompt)}>Sao chép prompt cho Flow</Button></div>)}</div>
    {chosen && <div className={styles.muted}>Chữ: {chosen.overlayText} · {thumbnailTextStatus(chosen.overlayText).words}/{thumbnailTextStatus(chosen.overlayText).max} từ</div>}
    <div className={styles.thumbnailUpload}>
      {thumbnailFile ? <a href={fileUrlForSummary(thumbnailFile)} target="_blank" rel="noreferrer">Xem thumbnail đã tải</a> : <span className={styles.muted}>Chưa có thumbnail</span>}
      <label className={styles.uploadButton}><span>{thumbnailFile ? 'Thay ảnh' : 'Tải ảnh'}</span><input type="file" accept="image/png,image/jpeg" onChange={upload} disabled={busy} /></label>
      {thumbnailFile && <Button size="sm" onClick={onRemove} disabled={busy}>Xoá</Button>}
      <span className={styles.muted}>{SEO_THUMBNAIL_WIDTH}×{SEO_THUMBNAIL_HEIGHT}, PNG/JPEG, ≤ {Math.round(SEO_THUMBNAIL_MAX_BYTES / 1024 / 1024)} MB</span>
    </div>
  </section>;
}
