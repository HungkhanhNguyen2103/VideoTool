import type { VisualStyleId } from '../../../../contracts/project';
import { VISUAL_STYLE_PACK_SLOTS, type VisualStylePacks } from '../../../../contracts/visual-style-pack';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast-store';
import { resolveVisualStylePreview } from '../visual-style-preview';
import styles from './StylePackPanel.module.css';

export type StylePackPanelProps = {
  styleId: VisualStyleId;
  packs?: VisualStylePacks;
  busy: boolean;
  onUpload: (styleId: VisualStyleId, slotId: string, file: File) => void;
  onDelete: (styleId: VisualStyleId, slotId: string) => void;
};

/** Copy the complete style block plus subject for one Flow reference image. */
export async function copyStylePackPrompt(
  prompt: string,
  writeText: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text),
  notify: (message: string) => void = toast,
): Promise<boolean> {
  try { await writeText(prompt); notify('Đã sao chép prompt'); return true; }
  catch { notify('Không thể sao chép prompt. Hãy thử lại.'); return false; }
}

export function StylePackPanel({ styleId, packs, busy, onUpload, onDelete }: StylePackPanelProps) {
  const slots = VISUAL_STYLE_PACK_SLOTS[styleId];
  const images = packs?.[styleId] ?? {};
  const uploadedCount = slots.filter((slot) => Boolean(images[slot.id])).length;

  return <section className={styles.panel} aria-label="Bộ ảnh phong cách">
    <div className={styles.header}>
      <h3>Bộ ảnh phong cách</h3>
      <span className={styles.counter}>{uploadedCount}/5 ảnh</span>
    </div>
    <p className={styles.hint}>Tạo các ảnh này trong Flow (sao chép prompt bên dưới), rồi thêm vào Project Style References.</p>
    <div className={styles.grid}>
      {slots.map((slot) => {
        const uploaded = images[slot.id];
        const preview = slot.id === 'core' ? resolveVisualStylePreview(styleId, uploaded) : uploaded
          ? { src: uploaded.url, alt: `Ảnh ${slot.label}`, filename: uploaded.filename } : undefined;
        return <div className={styles.tile} data-style-pack-tile={slot.id} key={slot.id}>
          <div className={styles.tileHead}><strong>{slot.label}</strong>{slot.id === 'core' && <span className={styles.primary}>Primary</span>}</div>
          <div className={styles.imageArea}>
            {preview ? <img src={preview.src} alt={preview.alt} /> : <span className={styles.placeholder}>{slot.hint}</span>}
          </div>
          <div className={styles.actions}>
            <Button size="sm" disabled={busy} onClick={() => void copyStylePackPrompt(slot.prompt)}>Sao chép prompt</Button>
            <label className={`${styles.uploadButton} ${busy ? styles.disabled : ''}`}>
              {uploaded ? 'Thay ảnh' : 'Upload'}
              <input data-slot-id={slot.id} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-label={`${uploaded ? 'Thay ảnh' : 'Upload'} ${slot.label}`} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) onUpload(styleId, slot.id, file);
                event.currentTarget.value = '';
              }} />
            </label>
            {uploaded && <Button size="sm" variant="red" disabled={busy} data-delete-slot={slot.id} onClick={() => onDelete(styleId, slot.id)}>Xóa</Button>}
          </div>
          {preview && <a className={styles.download} href={preview.src} download={preview.filename}>Tải ảnh</a>}
        </div>;
      })}
    </div>
  </section>;
}
