import type { SeoPackage, SeoPatch } from '../../../../contracts/seo';
import { titleStatus } from '../../../../contracts/seo-format';
import { Button } from '../../../shared/ui/Button';
import { TITLE_ANGLE_LABELS } from '../seo-view';
import styles from '../SeoPage.module.css';

type Props = { seo: SeoPackage; busy: boolean; generationDisabledReason?: string; generationLabel?: string; onPatch: (patch: SeoPatch) => void; onRegenerate: () => void; onFlush: () => void };

export function TitlesPanel({ seo, busy, generationDisabledReason, generationLabel = 'Tạo lại', onPatch, onRegenerate, onFlush }: Props) {
  return (
    <section className={styles.panel} aria-labelledby="seo-titles-title">
      <div className={styles.panelHead}><div><h2 id="seo-titles-title">Tiêu đề</h2><p className={styles.muted}>Chọn một phương án làm tiêu đề chính.</p></div><Button size="sm" onClick={onRegenerate} disabled={busy || Boolean(generationDisabledReason)} title={generationDisabledReason}>{generationLabel}</Button></div>
      {seo.titles.length === 0 ? <p className={styles.empty}>Chưa có phương án tiêu đề.</p> : <div className={styles.titleList}>
        {seo.titles.map((title) => {
          const status = titleStatus(title.text);
          return (
            <label key={title.id} className={`${styles.titleOption} ${title.id === seo.chosenTitleId ? styles.selected : ''}`}>
              <input type="radio" name="chosen-seo-title" checked={title.id === seo.chosenTitleId} onChange={() => onPatch({ chosenTitleId: title.id })} />
              <span className={styles.titleBody}>
                <span className={styles.angle}>{TITLE_ANGLE_LABELS[title.angle]}</span>
                <input aria-label={`Tiêu đề ${TITLE_ANGLE_LABELS[title.angle]}`} value={title.text} onChange={(event) => onPatch({ titles: seo.titles.map((item) => item.id === title.id ? { ...item, text: event.target.value } : item) })} onBlur={onFlush} />
                <span className={status.overLimit ? styles.error : status.warning ? styles.warning : styles.muted}>{status.length}/{status.max}{status.overLimit ? ' · quá giới hạn' : status.warning ? ' · nên rút gọn' : ''}</span>
              </span>
            </label>
          );
        })}
      </div>}
    </section>
  );
}
