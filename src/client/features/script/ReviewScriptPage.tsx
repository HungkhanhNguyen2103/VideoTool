import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ChapterDoc } from '../../../contracts/script';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { toast } from '../../shared/ui/toast-store';
import { useJobProgress } from '../../shared/hooks/use-job-progress';
import * as api from './api';
import styles from './ReviewScriptPage.module.css';

const statusTone = { approved: 'green', 'needs-fix': 'amber', generating: 'indigo', pending: 'muted' } as const;
const statusLabel = { approved: 'Đã duyệt', 'needs-fix': 'Cần sửa', generating: 'Đang tạo lại', pending: 'Chưa duyệt' } as const;

export function ReviewScriptPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [jobId, setJobId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editParagraphs, setEditParagraphs] = useState<string[]>([]);
  const [regen, setRegen] = useState<{ id: string; instruction: string; level: 'light' | 'medium' | 'rewrite'; preview: string; controller: AbortController } | null>(null);
  const regenControllerRef = useRef<AbortController | null>(null);
  const lifecycleRef = useRef(0);
  const [regenDraft, setRegenDraft] = useState<{ id: string; instruction: string; level: 'light' | 'medium' | 'rewrite' } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<api.ChapterSnapshot[]>([]);
  const progress = useJobProgress(jobId);
  const projectQuery = useQuery({ queryKey: ['projects', 'detail', projectId], queryFn: () => api.getProject(projectId), enabled: Boolean(projectId) });
  const chapters = projectQuery.data?.chapters ?? [];
  const allApproved = chapters.length > 0 && chapters.every((chapter) => chapter.status === 'approved');
  const selectedChapters = useMemo(() => chapters.filter((chapter) => selected.has(chapter.id)), [chapters, selected]);

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    return () => {
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1;
      regenControllerRef.current?.abort();
    };
  }, [projectId]);

  useEffect(() => {
    if (progress?.status === 'done') {
      void projectQuery.refetch();
      setJobId(null);
      toast('Đã tạo xong bản nháp kịch bản.');
    } else if (progress?.status === 'failed' || progress?.status === 'cancelled') {
      toast(progress.error ?? 'Không thể tạo kịch bản.');
      setJobId(null);
    }
  }, [progress?.status]);

  async function generate() {
    try { setJobId((await api.generateScript(projectId)).jobId); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tạo kịch bản.'); }
  }

  async function refresh() { await projectQuery.refetch(); }

  async function patch(chapterId: string, body: Parameters<typeof api.patchChapter>[2]) {
    try { await api.patchChapter(projectId, chapterId, body); await refresh(); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể cập nhật chương.'); }
  }

  function startEdit(chapter: ChapterDoc) { setEditing(chapter.id); setEditParagraphs([...chapter.paragraphs]); }

  async function saveEdit(chapterId: string) { await patch(chapterId, { paragraphs: editParagraphs }); setEditing(null); }

  async function regenerate(chapter: ChapterDoc, instruction = '', level: 'light' | 'medium' | 'rewrite' = 'medium') {
    if (regenControllerRef.current) return;
    const controller = new AbortController();
    regenControllerRef.current = controller;
    setRegen({ id: chapter.id, instruction, level, preview: '', controller });
    try {
      await api.regenerateChapter(projectId, chapter.id, { instruction, level }, (chunk) => setRegen((current) => current ? { ...current, preview: current.preview + chunk } : current), controller.signal);
      await refresh();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast(error instanceof Error ? error.message : 'Không thể tái tạo chương.');
      await refresh();
    } finally {
      if (regenControllerRef.current === controller) regenControllerRef.current = null;
      setRegen((current) => current?.controller === controller ? null : current);
    }
  }

  async function regenerateSelected() {
    if (regenControllerRef.current) return;
    const lifecycle = lifecycleRef.current;
    for (const chapter of selectedChapters) {
      if (lifecycleRef.current !== lifecycle) return;
      await regenerate(chapter, '', 'medium');
    }
  }

  function openRegen(chapter: ChapterDoc) { setRegenDraft({ id: chapter.id, instruction: '', level: 'medium' }); }

  async function approveSelected() {
    if (regenControllerRef.current || selectedChapters.some((chapter) => chapter.status === 'generating')) return;
    await Promise.all(selectedChapters.map((chapter) => api.patchChapter(projectId, chapter.id, { status: 'approved' })));
    await refresh();
  }

  async function loadHistory() {
    try { setHistory(await api.getChapterHistory(projectId)); setHistoryOpen(true); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể tải lịch sử.'); }
  }

  async function restore(index: number) {
    if (!window.confirm('Khôi phục phiên bản này?')) return;
    try { await api.restoreChapters(projectId, index); await refresh(); setHistoryOpen(false); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể khôi phục.'); }
  }

  async function finalize() {
    if (!window.confirm('Chốt kịch bản và chia cảnh?')) return;
    try { await api.finalizeScript(projectId); toast('Đã chốt kịch bản.'); navigate(`/production/${projectId}/studio`); } catch (error) { toast(error instanceof Error ? error.message : 'Không thể chốt kịch bản.'); }
  }

  if (projectQuery.isLoading) return <section className={styles.panel}><p>Đang tải kịch bản…</p></section>;
  if (projectQuery.error) return <section className={styles.panel}><p className={styles.error}>Không thể tải dự án.</p></section>;

  return (
    <div className={styles.page}>
      <ol className={styles.stepper} aria-label="Tiến trình sản xuất">
        {['Dàn ý', 'Nháp kịch bản', 'Duyệt & Tái Tạo', 'Chốt & Chia Cảnh'].map((label, index) => (
          <li className={styles.step} key={label} aria-current={index === 2 ? 'step' : undefined}><span className={styles.stepLabel}>{index + 1}. {label}</span><span className={styles.stepSub}>{index < 2 ? 'Hoàn tất' : index === 2 ? 'Đang thực hiện' : allApproved ? 'Sẵn sàng' : 'Chưa bắt đầu'}</span></li>
        ))}
      </ol>

      {!chapters.length && !jobId ? (
        <section className={styles.panel} aria-labelledby="generate-title">
          <h2 id="generate-title">Nháp kịch bản</h2>
          <p className={styles.muted}>AI sẽ viết kịch bản theo brief và preset của dự án.</p>
          <Button variant="amber" onClick={() => void generate()}>Tạo kịch bản</Button>
        </section>
      ) : (
        <section className={styles.panel}>
          {jobId && progress && progress.status !== 'done' && (
            <div className={styles.chapter} role="status"><strong>Đang tạo kịch bản… {Math.round(progress.progress)}%</strong><div className={styles.logs}>{progress.logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div></div>
          )}
          <div className={styles.toolbar}><strong>{chapters.length} chương</strong><div className={styles.actions}><Button size="sm" onClick={() => void loadHistory()}>Lịch sử</Button>{selectedChapters.length > 0 && <><Button size="sm" disabled={Boolean(regen) || selectedChapters.some((chapter) => chapter.status === 'generating')} onClick={() => void approveSelected()}>Duyệt tất cả</Button><Button size="sm" variant="indigoline" disabled={Boolean(regen) || selectedChapters.some((chapter) => chapter.status === 'generating')} onClick={() => void regenerateSelected()}>Tái tạo đã chọn</Button></>}</div></div>
          {chapters.map((chapter) => {
            const busy = regen?.id === chapter.id || chapter.status === 'generating';
            const isEditing = editing === chapter.id;
            return <article className={styles.chapter} key={chapter.id}>
              <div className={styles.chapterTop}>
                <input type="checkbox" checked={selected.has(chapter.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(chapter.id); else next.delete(chapter.id); return next; })} aria-label={`Chọn chương ${chapter.no}`} />
                <span className={styles.chapterNo}>{String(chapter.no).padStart(2, '0')}</span><span className={styles.chapterTitle}>{chapter.title}</span><span className={styles.chapterMeta}>{chapter.scenesCount ?? '—'} cảnh · {chapter.durationSec ?? '—'}s</span><span className={styles.spacer} /><Badge tone={statusTone[chapter.status]}>{statusLabel[chapter.status]}</Badge>
              </div>
              <div className={styles.body}>{isEditing ? <><textarea className={styles.textarea} value={editParagraphs.join('\n\n')} onChange={(event) => setEditParagraphs(event.target.value.split(/\n\s*\n/))} aria-label={`Sửa nội dung chương ${chapter.no}`} /><div className={styles.actions}><Button size="sm" onClick={() => setEditing(null)}>Hủy</Button><Button size="sm" variant="amber" onClick={() => void saveEdit(chapter.id)}>Lưu</Button></div></> : chapter.paragraphs.map((paragraph, index) => <p key={`${chapter.id}-${index}`}>{paragraph}</p>)}</div>
              {regen?.id === chapter.id && <div className={styles.regen}><span>Đang xem trước bản tái tạo…</span><div className={styles.preview}>{regen.preview || 'Đang nhận token…'}</div><Button size="sm" variant="red" onClick={() => regen.controller.abort()}>Hủy</Button></div>}
              {!isEditing && <div className={styles.actions}><Button size="sm" disabled={busy} onClick={() => void patch(chapter.id, { status: 'needs-fix' })}>Cần sửa</Button><Button size="sm" disabled={busy} onClick={() => startEdit(chapter)}>Sửa</Button><Button size="sm" variant="indigoline" disabled={busy} onClick={() => openRegen(chapter)}>Tái tạo</Button><Button size="sm" variant={chapter.status === 'approved' ? 'amber' : 'ghost'} disabled={busy} onClick={() => void patch(chapter.id, { status: 'approved' })}>{chapter.status === 'approved' ? 'Đã duyệt' : 'Duyệt'}</Button></div>}
              {regenDraft?.id === chapter.id && !regen && <div className={styles.regen}><label>Yêu cầu tái tạo<textarea className={styles.textarea} value={regenDraft.instruction} onChange={(event) => setRegenDraft({ ...regenDraft, instruction: event.target.value })} placeholder="Ví dụ: làm ngắn gọn hơn" /></label><label>Mức độ<select value={regenDraft.level} onChange={(event) => setRegenDraft({ ...regenDraft, level: event.target.value as 'light' | 'medium' | 'rewrite' })}><option value="light">Nhẹ</option><option value="medium">Vừa</option><option value="rewrite">Viết lại</option></select></label><div className={styles.actions}><Button size="sm" onClick={() => setRegenDraft(null)}>Hủy</Button><Button size="sm" variant="indigoline" onClick={() => { const draft = regenDraft; setRegenDraft(null); void regenerate(chapter, draft.instruction, draft.level); }}>Bắt đầu</Button></div></div>}
            </article>;
          })}
        </section>
      )}

      {historyOpen && <aside className={styles.history} aria-label="Lịch sử phiên bản"><div className={styles.historyHead}><strong>Lịch sử phiên bản</strong><Button size="sm" onClick={() => setHistoryOpen(false)}>Đóng</Button></div><ul className={styles.historyList}>{history.map((snapshot, index) => <li className={styles.historyItem} key={`${snapshot.takenAt.toISOString()}-${index}`}><span>{snapshot.takenAt.toLocaleString('vi-VN')}</span><Button size="sm" onClick={() => void restore(index)}>Khôi phục</Button></li>)}</ul></aside>}
      <footer className={styles.footer}><Button variant="amber" disabled={!allApproved || Boolean(regen) || Boolean(jobId)} onClick={() => void finalize()}>Chốt & chia cảnh</Button></footer>
    </div>
  );
}
