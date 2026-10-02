import type { SeoSection } from '../../../../contracts/seo';
import { Button } from '../../../shared/ui/Button';
import styles from '../SeoPage.module.css';

type Props = { prompt: string; raw: string; error: string | null; busy: boolean; sections: SeoSection[]; onRawChange: (value: string) => void; onLoadPrompt: () => void; onImport: () => void };

export function ManualSeoPanel({ prompt, raw, error, busy, sections, onRawChange, onLoadPrompt, onImport }: Props) {
  return <section className={styles.manualPanel} aria-labelledby="seo-manual-title">
    <div className={styles.panelHead}><div><h2 id="seo-manual-title">Thủ công (JSON)</h2><p className={styles.muted}>Lấy prompt, dán vào AI bất kỳ, rồi dán JSON kết quả vào đây.</p></div><Button onClick={onLoadPrompt} disabled={busy} busy={busy}>Lấy prompt</Button></div>
    {prompt && <textarea className={styles.promptBox} value={prompt} readOnly aria-label="Prompt SEO" />}
    <textarea className={styles.textarea} value={raw} onChange={(event) => onRawChange(event.target.value)} placeholder="Dán JSON kết quả vào đây…" aria-label="JSON SEO" />
    {error && <p className={styles.error}>{error}</p>}
    <div className={styles.actions}><span className={styles.muted}>Nhập {sections.length} phần đã chọn</span><Button variant="amber" onClick={onImport} disabled={busy || !raw.trim()} busy={busy}>Nhập JSON</Button></div>
  </section>;
}
