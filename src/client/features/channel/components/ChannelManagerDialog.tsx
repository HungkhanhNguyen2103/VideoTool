import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Channel, CreateChannelRequest } from '../../../../contracts/channel';
import { Button } from '../../../shared/ui/Button';
import { channelEditorInput, formatChannelLinks } from '../channel-helpers';
import { useChannels, useCreateChannel, useDeleteChannel, useUpdateChannel } from '../hooks';
import styles from './ChannelManagerDialog.module.css';

type ChannelEditor = {
  name: string;
  handle: string;
  tagline: string;
  description: string;
  language: 'vi' | 'en';
  linksText: string;
  defaultHashtagsText: string;
  descriptionFooter: string;
  aiDisclosureText: string;
  thumbnailTemplate: string;
};

type ChannelEditorPrefill = Partial<Pick<Channel, 'name' | 'handle' | 'tagline' | 'language'>>;

const EMPTY_EDITOR: ChannelEditor = {
  name: '', handle: '', tagline: '', description: '', language: 'vi', linksText: '',
  defaultHashtagsText: '', descriptionFooter: '', aiDisclosureText: '', thumbnailTemplate: '',
};

function editorFromChannel(channel: Channel): ChannelEditor {
  return {
    name: channel.name,
    handle: channel.handle ?? '',
    tagline: channel.tagline,
    description: channel.description,
    language: channel.language,
    linksText: formatChannelLinks(channel),
    defaultHashtagsText: channel.defaultHashtags.join('\n'),
    descriptionFooter: channel.descriptionFooter,
    aiDisclosureText: channel.aiDisclosureText ?? '',
    thumbnailTemplate: channel.thumbnailTemplate ?? '',
  };
}

export type ChannelManagerDialogProps = {
  open: boolean;
  prefill?: ChannelEditorPrefill | null;
  onPrefillConsumed?: () => void;
  onClose: () => void;
};

export function ChannelManagerDialog({ open, prefill, onPrefillConsumed, onClose }: ChannelManagerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const channelsQuery = useChannels();
  const createMutation = useCreateChannel();
  const updateMutation = useUpdateChannel();
  const deleteMutation = useDeleteChannel();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<ChannelEditor>(EMPTY_EDITOR);
  const [pendingDelete, setPendingDelete] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !prefill) return;
    setEditingId(null);
    setPendingDelete(null);
    setEditor({ ...EMPTY_EDITOR, ...prefill });
    setError(null);
    onPrefillConsumed?.();
  }, [onPrefillConsumed, open, prefill]);

  function startNew() {
    setEditingId(null);
    setEditor(EMPTY_EDITOR);
    setError(null);
    setPendingDelete(null);
  }

  function editChannel(channel: Channel) {
    setEditingId(channel.id);
    setEditor(editorFromChannel(channel));
    setError(null);
    setPendingDelete(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const input: CreateChannelRequest = channelEditorInput(editor);
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, input: {
          ...input,
          handle: input.handle ?? null,
          aiDisclosureText: editor.aiDisclosureText,
          thumbnailTemplate: editor.thumbnailTemplate,
        } });
      } else {
        await createMutation.mutateAsync(input);
      }
      startNew();
      await channelsQuery.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể lưu kênh.');
    }
  }

  async function removeChannel() {
    if (!pendingDelete) return;
    setError(null);
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      if (editingId === pendingDelete.id) startNew();
      setPendingDelete(null);
      await channelsQuery.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể xóa kênh.');
    }
  }

  function updateEditor<K extends keyof ChannelEditor>(key: K, value: ChannelEditor[K]) {
    setEditor((current) => ({ ...current, [key]: value }));
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="channel-manager-title"
      onClose={onClose}
    >
      <div className={styles.card}>
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>HỒ SƠ KÊNH</p><h2 id="channel-manager-title">Quản lý kênh</h2></div>
          <Button size="sm" onClick={() => dialogRef.current?.close()}>Đóng</Button>
        </header>
        <div className={styles.body}>
          <section className={styles.listPanel} aria-label="Danh sách kênh">
            <div className={styles.panelHeader}>
              <h3>Kênh đã lưu</h3>
              <Button size="sm" onClick={startNew} disabled={busy}>Tạo kênh</Button>
            </div>
            {channelsQuery.isLoading && <p className={styles.muted}>Đang tải danh sách kênh…</p>}
            {channelsQuery.error && <p className={styles.error} role="alert">Không tải được danh sách kênh.</p>}
            <div className={styles.channelList}>
              {(channelsQuery.data ?? []).map((channel) => (
                <article className={`${styles.channelItem} ${editingId === channel.id ? styles.selected : ''}`} key={channel.id}>
                  <div className={styles.channelName}><strong>{channel.name}</strong>{channel.handle && <span>{channel.handle}</span>}</div>
                  {channel.tagline && <p>{channel.tagline}</p>}
                  <div className={styles.itemActions}>
                    <Button size="sm" onClick={() => editChannel(channel)} disabled={busy}>Sửa</Button>
                    <Button size="sm" variant="red" onClick={() => setPendingDelete(channel)} disabled={busy}>Xóa</Button>
                  </div>
                </article>
              ))}
              {!channelsQuery.isLoading && !channelsQuery.error && (channelsQuery.data?.length ?? 0) === 0 && <p className={styles.muted}>Chưa có kênh. Tạo hồ sơ đầu tiên ở đây.</p>}
            </div>
          </section>

          <section className={styles.editorPanel}>
            {pendingDelete ? (
              <div className={styles.deletePrompt}>
                <h3>Xóa “{pendingDelete.name}”?</h3>
                <p>Kênh đang được dự án sử dụng sẽ không thể xóa.</p>
                <div className={styles.actions}>
                  <Button onClick={() => setPendingDelete(null)} disabled={busy}>Hủy</Button>
                  <Button variant="red" onClick={() => void removeChannel()} disabled={busy}>{deleteMutation.isPending ? 'Đang xóa…' : 'Xác nhận xóa'}</Button>
                </div>
              </div>
            ) : (
              <form className={styles.form} onSubmit={(event) => void save(event)}>
                <div className={styles.panelHeader}><h3>{editingId ? 'Sửa hồ sơ kênh' : 'Tạo hồ sơ kênh'}</h3></div>
                {error && <p className={styles.error} role="alert">{error}</p>}
                <label className={styles.field}>Tên kênh<input required maxLength={100} value={editor.name} onChange={(event) => updateEditor('name', event.target.value)} /></label>
                <label className={styles.field}>Handle YouTube<input maxLength={31} placeholder="@tenkenh" value={editor.handle} onChange={(event) => updateEditor('handle', event.target.value)} /></label>
                <label className={styles.field}>Tagline<input maxLength={200} value={editor.tagline} onChange={(event) => updateEditor('tagline', event.target.value)} /></label>
                <label className={styles.field}>Ngôn ngữ<select value={editor.language} onChange={(event) => updateEditor('language', event.target.value as 'vi' | 'en')}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
                <label className={styles.field}>Mô tả kênh<textarea maxLength={1000} value={editor.description} onChange={(event) => updateEditor('description', event.target.value)} /></label>
                <label className={styles.field}>Liên kết, mỗi dòng “nhãn | URL”<textarea value={editor.linksText} onChange={(event) => updateEditor('linksText', event.target.value)} placeholder="Trang chủ | https://example.com" /></label>
                <label className={styles.field}>Hashtag mặc định<textarea value={editor.defaultHashtagsText} onChange={(event) => updateEditor('defaultHashtagsText', event.target.value)} placeholder="#LichSu" /></label>
                <label className={styles.field}>Đoạn chân mô tả<textarea maxLength={1500} value={editor.descriptionFooter} onChange={(event) => updateEditor('descriptionFooter', event.target.value)} /></label>
                <label className={styles.field}>Dòng công bố AI (không bắt buộc)<textarea maxLength={500} value={editor.aiDisclosureText} onChange={(event) => updateEditor('aiDisclosureText', event.target.value)} /></label>
                <label className={styles.field}>Mẫu bố cục thumbnail<textarea maxLength={4000} value={editor.thumbnailTemplate} onChange={(event) => updateEditor('thumbnailTemplate', event.target.value)} /></label>
                <div className={styles.actions}>
                  {editingId && <Button type="button" onClick={startNew} disabled={busy}>Hủy sửa</Button>}
                  <Button type="submit" disabled={busy || channelsQuery.isLoading}>{busy ? 'Đang lưu…' : editingId ? 'Lưu thay đổi' : 'Tạo kênh'}</Button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </dialog>
  );
}

export type { ChannelEditorPrefill };
