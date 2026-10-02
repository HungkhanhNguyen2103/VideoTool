import type { SeoPackage, SeoPatch } from '../../../../contracts/seo';
import { Button } from '../../../shared/ui/Button';
import styles from '../SeoPage.module.css';

type Props = { seo: SeoPackage; busy: boolean; onPatch: (patch: SeoPatch) => void; onRegenerate: () => void; onFlush: () => void };

export function PinnedCommentPanel({ seo, busy, onPatch, onRegenerate, onFlush }: Props) {
  async function copy() { await navigator.clipboard.writeText(seo.pinnedComment); }
  return <section className={styles.panel} aria-labelledby="seo-comment-title">
    <div className={styles.panelHead}><div><h2 id="seo-comment-title">Bình luận ghim</h2><p className={styles.muted}>Một câu hỏi mở để kéo người xem vào cuộc trò chuyện.</p></div><Button size="sm" onClick={onRegenerate} disabled={busy}>Tạo lại</Button></div>
    <textarea className={styles.textarea} value={seo.pinnedComment} onChange={(event) => onPatch({ pinnedComment: event.target.value })} onBlur={onFlush} aria-label="Bình luận ghim" />
    <div className={styles.actions}><Button size="sm" onClick={() => void copy()}>Sao chép</Button></div>
  </section>;
}
