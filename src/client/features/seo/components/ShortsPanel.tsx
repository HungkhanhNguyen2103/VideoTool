import { useState } from 'react';
import type { ProjectDetail } from '../../../../contracts/project';
import { ensureShortsHashtag, SEO_LONG_VIDEO_URL_MAX_CHARS, SEO_SHORTS_CAPTION_MAX_CHARS, SEO_SHORTS_HASHTAGS_MAX_COUNT, SEO_SHORTS_TITLE_MAX_CHARS, type SeoPackage, type SeoPatch, type SeoShort } from '../../../../contracts/seo';
import { formatTimestamp, substituteLongVideoUrl } from '../../../../contracts/seo-format';
import { pickShortsWindows, sameShortsWindowFields } from '../../../../contracts/seo-shorts';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast-store';
import { buildShortsPanelItems, copyShortsText } from '../shorts-view';
import styles from './ShortsPanel.module.css';

type Props = { project: ProjectDetail; busy: boolean; onPatch: (patch: SeoPatch) => void; onRegenerate: () => void; onFlush: () => void };

export function ShortsPanel({ project, busy, onPatch, onRegenerate, onFlush }: Props) {
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [hashtagDrafts, setHashtagDrafts] = useState<Record<string, string>>({});
  const seo: SeoPackage = project.seo;
  const { windows, warnings } = pickShortsWindows(project);
  const storedSetMatches = sameShortsWindowFields(seo.shorts, windows);
  const items = buildShortsPanelItems(project);

  function updateShort(shortId: string, patch: Partial<SeoShort>) {
    const shorts = items.map(({ short }) => short.id === shortId ? { ...short, ...patch } : short);
    onPatch({ shorts });
  }

  function changeHashtags(shortId: string, value: string) {
    setHashtagDrafts((previous) => ({ ...previous, [shortId]: value }));
    updateShort(shortId, { hashtags: ensureShortsHashtag(value.split(/[\s,]+/u).filter(Boolean)) });
  }

  async function copy(text: string) {
    const result = await copyShortsText(text, async (value) => {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
    });
    setFallbackText(result.fallbackText);
    if (result.copied) toast('Đã sao chép nội dung Shorts.');
  }

  return <section className={styles.panel} aria-labelledby="seo-shorts-title">
    <div className={styles.panelHead}>
      <div><h2 id="seo-shorts-title">Gói Shorts</h2><p className={styles.muted}>Các mốc cắt là gợi ý xác định theo cảnh; mốc và lời dẫn không được AI tự thay đổi.</p></div>
      <Button size="sm" onClick={onRegenerate} disabled={busy}>Tạo lại gói Shorts</Button>
    </div>
    <label className={styles.field} htmlFor="seo-long-video-url">URL video dài
      <input id="seo-long-video-url" className={styles.input} type="url" maxLength={SEO_LONG_VIDEO_URL_MAX_CHARS} value={seo.longVideoUrl} onChange={(event) => onPatch({ longVideoUrl: event.target.value })} onBlur={onFlush} disabled={busy} placeholder="https://…" />
    </label>
    <div className={styles.counter}>{seo.longVideoUrl.length}/{SEO_LONG_VIDEO_URL_MAX_CHARS} ký tự · URL chỉ được thay vào caption khi hiển thị hoặc xuất.</div>
    {warnings.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
    {seo.shorts.length > 0 && !storedSetMatches && <p className={styles.warning}>Mốc cắt có thể đã cũ; hãy tạo lại gói Shorts trước khi chỉnh nội dung.</p>}
    {windows.length === 0
      ? <p className={styles.empty}>Video chưa có đoạn 30–55 giây phù hợp để gợi ý Shorts.</p>
      : items.length === 0
        ? <p className={styles.empty}>Chưa có ứng viên Shorts.</p>
        : <div className={styles.list}>{items.map(({ window, short, saved, narrationExcerpt, previewCaption, unresolvedPlaceholder }) => {
          const editable = saved && !busy;
          const hashtagsText = hashtagDrafts[short.id] ?? short.hashtags.join(' ');
          const copyAll = [
            `Tiêu đề: ${short.title}`,
            `Caption: ${previewCaption}`,
            `Hashtags: ${short.hashtags.join(' ')}`,
          ].join('\n');
          return <article className={styles.card} key={window.id}>
            <div className={styles.cardHead}><h3>{formatTimestamp(window.startSec)}–{formatTimestamp(window.endSec)} · Chương {window.chapterNo}</h3><span>{formatTimestamp(window.endSec - window.startSec)} · gợi ý</span></div>
            <p className={styles.excerpt}><strong>Lời dẫn trong đoạn</strong><br />{narrationExcerpt || 'Không có lời dẫn.'}</p>
            <p className={styles.hook}><strong>Hook:</strong> {short.hookLine || 'Chưa tạo gói Shorts.'}</p>
            {!saved && <p className={styles.muted}>Tạo gói Shorts để mở nội dung chỉnh sửa.</p>}
            <label className={styles.field}>Tiêu đề
              <input className={styles.input} value={short.title} maxLength={SEO_SHORTS_TITLE_MAX_CHARS} onChange={(event) => updateShort(short.id, { title: event.target.value })} onBlur={onFlush} disabled={!editable} />
            </label>
            <div className={styles.counter}>{short.title.length}/{SEO_SHORTS_TITLE_MAX_CHARS} ký tự</div>
            <label className={styles.field}>Caption
              <textarea className={styles.textarea} value={short.caption} maxLength={SEO_SHORTS_CAPTION_MAX_CHARS} onChange={(event) => updateShort(short.id, { caption: event.target.value })} onBlur={onFlush} disabled={!editable} />
            </label>
            <div className={styles.counter}>{short.caption.length}/{SEO_SHORTS_CAPTION_MAX_CHARS} ký tự</div>
            <label className={styles.field}>Hashtags
              <input className={styles.input} value={hashtagsText} onChange={(event) => changeHashtags(short.id, event.target.value)} onBlur={onFlush} disabled={!editable} aria-describedby={`seo-shorts-hashtags-${short.id}`} />
            </label>
            <div id={`seo-shorts-hashtags-${short.id}`} className={styles.counter}>{short.hashtags.length}/{SEO_SHORTS_HASHTAGS_MAX_COUNT} · luôn có #Shorts</div>
            {short.reason && <p className={styles.muted}>Lý do: {short.reason}</p>}
            {previewCaption && <p className={`${styles.preview} ${unresolvedPlaceholder ? styles.warning : ''}`}>
              <strong>Xem trước caption:</strong> {unresolvedPlaceholder
                ? previewCaption.split('{LONG_VIDEO_URL}').flatMap((part, index, all) => index < all.length - 1 ? [part, <mark key={`${short.id}-placeholder-${index}`}>{'{LONG_VIDEO_URL}'}</mark>] : [part])
                : substituteLongVideoUrl(short.caption, seo.longVideoUrl)}
            </p>}
            <div className={styles.actions}>
              <Button size="sm" disabled={!short.title || !editable} onClick={() => void copy(short.title)}>Sao chép tiêu đề</Button>
              <Button size="sm" disabled={!short.caption || !editable} onClick={() => void copy(previewCaption)}>Sao chép caption</Button>
              <Button size="sm" disabled={!short.hashtags.length || !editable} onClick={() => void copy(short.hashtags.join(' '))}>Sao chép hashtags</Button>
              <Button size="sm" disabled={!short.title || !editable} onClick={() => void copy(copyAll)}>Sao chép tất cả</Button>
            </div>
          </article>;
        })}</div>}
    <p className={styles.note}>Cắt và dựng bản dọc làm thủ công; chưa có render Shorts trong bước này.</p>
    {fallbackText && <div className={styles.fallback} role="status">
      <p>Không thể sao chép tự động. Hãy chọn và sao chép nội dung bên dưới.</p>
      <textarea className={styles.textarea} aria-label="Nội dung Shorts để sao chép thủ công" readOnly value={fallbackText} onFocus={(event) => event.currentTarget.select()} />
    </div>}
  </section>;
}
