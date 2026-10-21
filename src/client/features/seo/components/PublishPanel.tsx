import type { FileSummary } from '../../../../contracts/file';
import type { ProjectDetail } from '../../../../contracts/project';
import type { Channel } from '../../../../contracts/channel';
import { buildPublishChecklist } from '../../../../contracts/seo-format';
import { fileUrlForSummary } from '../../asset/api';
import { Button } from '../../../shared/ui/Button';
import styles from '../SeoPage.module.css';

type Props = { project: ProjectDetail; thumbnailFile?: FileSummary; renderFile?: FileSummary; channel?: Channel; onCopy: () => void; onDownload: () => void };

export function PublishPanel({ project, thumbnailFile, renderFile, channel, onCopy, onDownload }: Props) {
  const checklist = buildPublishChecklist(project, thumbnailFile, channel);
  return <section className={styles.panel} aria-labelledby="seo-publish-title">
    <div className={styles.panelHead}><div><h2 id="seo-publish-title">Sẵn sàng đăng</h2><p className={styles.muted}>Kiểm tra lần cuối trước khi đưa video lên YouTube.</p></div><div className={styles.actions}><Button onClick={onCopy}>Sao chép tất cả</Button><Button variant="amber" onClick={onDownload}>Tải gói đăng (.md)</Button></div></div>
    <ul className={styles.checklist}>{checklist.map((item) => <li key={item.key} className={item.reminder ? styles.checkReminder : item.warning ? styles.checkWarning : item.done ? styles.checkDone : styles.checkPending}><span aria-hidden="true">{item.reminder ? 'i' : item.warning ? '!' : item.done ? '✓' : '○'}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></li>)}</ul>
    <div className={styles.publishLinks}>
      {renderFile ? <a href={fileUrlForSummary(renderFile)} download>⬇ Tải video render</a> : <span className={styles.muted}>Chưa có link video render</span>}
      {thumbnailFile ? <a href={fileUrlForSummary(thumbnailFile)} download>⬇ Tải thumbnail</a> : <span className={styles.muted}>Chưa có link thumbnail</span>}
    </div>
  </section>;
}
