import type { ProjectDetail } from '../../../../contracts/project';
import type { SeoPackage, SeoPatch } from '../../../../contracts/seo';
import { SEO_DESCRIPTION_MAX_CHARS } from '../../../../contracts/seo';
import { Button } from '../../../shared/ui/Button';
import styles from '../SeoPage.module.css';

type Props = { project: ProjectDetail; seo: SeoPackage; description: string; busy: boolean; onPatch: (patch: SeoPatch) => void; onRegenerate: () => void; onFlush: () => void };

export function DescriptionPanel({ project, seo, description, busy, onPatch, onRegenerate, onFlush }: Props) {
  async function copyDescription() {
    await navigator.clipboard.writeText(description);
  }
  return (
    <section className={styles.panel} aria-labelledby="seo-description-title">
      <div className={styles.panelHead}><div><h2 id="seo-description-title">Mô tả</h2><p className={styles.muted}>Mốc chương chỉ xuất hiện khi timing thật của video đủ điều kiện.</p></div><Button size="sm" onClick={onRegenerate} disabled={busy}>Tạo lại</Button></div>
      <textarea className={styles.textarea} value={seo.descriptionIntro} maxLength={SEO_DESCRIPTION_MAX_CHARS} onChange={(event) => onPatch({ descriptionIntro: event.target.value })} onBlur={onFlush} aria-label="Mở đầu mô tả" />
      <div className={styles.counter}>{seo.descriptionIntro.length}/{SEO_DESCRIPTION_MAX_CHARS} · dữ liệu đầu vào: {project.language}</div>
      <div className={styles.preview}><div className={styles.previewHead}><strong>Xem trước đầy đủ</strong><Button size="sm" onClick={() => void copyDescription()}>Sao chép</Button></div><pre>{description || 'Chưa có mô tả.'}</pre></div>
    </section>
  );
}
