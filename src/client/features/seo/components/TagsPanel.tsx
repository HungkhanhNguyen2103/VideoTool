import { useState } from 'react';
import type { SeoPackage, SeoPatch } from '../../../../contracts/seo';
import { SEO_HASHTAGS_MAX_COUNT, SEO_HASHTAGS_VISIBLE_COUNT } from '../../../../contracts/seo';
import { tagBudget, hashtagStatus } from '../../../../contracts/seo-format';
import { Button } from '../../../shared/ui/Button';
import styles from '../SeoPage.module.css';

type Props = { seo: SeoPackage; busy: boolean; generationDisabledReason?: string; generationLabel?: string; onPatch: (patch: SeoPatch) => void; onRegenerate: () => void; onFlush: () => void };

export function TagsPanel({ seo, busy, generationDisabledReason, generationLabel = 'Tạo lại', onPatch, onRegenerate, onFlush }: Props) {
  const [tagInput, setTagInput] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const budget = tagBudget(seo.tags);
  const hashtags = hashtagStatus(seo.hashtags);
  function addTag() {
    const values = tagInput.split(',').map((value) => value.trim()).filter(Boolean);
    if (values.length) onPatch({ tags: [...seo.tags, ...values] });
    setTagInput('');
  }
  function addHashtag() {
    const values = hashtagInput.split(/\s+/u).map((value) => value.trim()).filter(Boolean);
    if (values.length) onPatch({ hashtags: [...seo.hashtags, ...values].slice(0, SEO_HASHTAGS_MAX_COUNT) });
    setHashtagInput('');
  }
  return (
    <section className={styles.panel} aria-labelledby="seo-tags-title">
      <div className={styles.panelHead}><div><h2 id="seo-tags-title">Tags &amp; hashtag</h2><p className={styles.muted}>Ba hashtag đầu được đánh dấu vị trí hiện trên tiêu đề.</p></div><Button size="sm" onClick={onRegenerate} disabled={busy || Boolean(generationDisabledReason)} title={generationDisabledReason}>{generationLabel}</Button></div>
      <div className={styles.chipGroup}>{seo.tags.map((tag, index) => <button className={styles.chip} type="button" key={`${tag}-${index}`} onClick={() => onPatch({ tags: seo.tags.filter((_, itemIndex) => itemIndex !== index) })}>{tag} ×</button>)}</div>
      <div className={styles.addRow}><input className={styles.input} value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="Thêm tags, phân tách bằng dấu phẩy" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} onBlur={onFlush} /><Button size="sm" onClick={addTag}>Thêm</Button><span className={budget.overLimit ? styles.error : styles.muted}>{budget.used}/{budget.max} ký tự</span></div>
      <div className={styles.chipGroup}>{seo.hashtags.map((tag, index) => <button className={`${styles.chip} ${index < SEO_HASHTAGS_VISIBLE_COUNT ? styles.chipVisible : ''}`} type="button" key={`${tag}-${index}`} onClick={() => onPatch({ hashtags: seo.hashtags.filter((_, itemIndex) => itemIndex !== index) })}>{tag}{index < SEO_HASHTAGS_VISIBLE_COUNT ? ' · hiện' : ''} ×</button>)}</div>
      <div className={styles.addRow}><input className={styles.input} value={hashtagInput} onChange={(event) => setHashtagInput(event.target.value)} placeholder="#DienBienPhu" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addHashtag(); } }} onBlur={onFlush} /><Button size="sm" onClick={addHashtag}>Thêm</Button><span className={hashtags.ok ? styles.muted : styles.warning}>{hashtags.count}/{hashtags.max} hashtag</span></div>
    </section>
  );
}
