import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Channel, CreateChannelRequest } from '../../../../contracts/channel';
import { PUBLISH_SCHEDULE_STARTER_WINDOWS, type PublishSchedule } from '../../../../contracts/channel-schedule';
import { Button } from '../../../shared/ui/Button';
import { ChannelYoutubeControls } from '../../youtube/components/ChannelYoutubeControls';
import { channelEditorInput, channelScheduleEditor, formatChannelLinks, isChannelEditorDirty, profileRefreshNeedsConfirmation, starterScheduleEditor } from '../channel-helpers';
import { useChannels, useCreateChannel, useDeleteChannel, useUpdateChannel } from '../hooks';
import { beginYoutubeImport } from '../../youtube/api';
import { useYoutubeSetupStatus } from '../../youtube/hooks';
import { useYoutubeOauthPopup, type YoutubeOauthFinishedMessage } from '../../youtube/use-youtube-oauth-popup';
import { youtubeImportResultSummary } from '../../youtube/youtube-view';
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
  publishTimezone: string;
  publishSlots: PublishSchedule['slots'];
  publishNotes: string;
};

type ChannelEditorPrefill = Partial<Pick<Channel, 'name' | 'handle' | 'tagline' | 'language'>>;

const EMPTY_EDITOR: ChannelEditor = {
  name: '', handle: '', tagline: '', description: '', language: 'vi', linksText: '',
  defaultHashtagsText: '', descriptionFooter: '', aiDisclosureText: '', thumbnailTemplate: '',
  publishTimezone: 'Asia/Ho_Chi_Minh', publishSlots: [], publishNotes: '',
};

const WEEKDAYS = [
  { value: 0, label: 'Chủ nhật' },
  { value: 1, label: 'Thứ Hai' },
  { value: 2, label: 'Thứ Ba' },
  { value: 3, label: 'Thứ Tư' },
  { value: 4, label: 'Thứ Năm' },
  { value: 5, label: 'Thứ Sáu' },
  { value: 6, label: 'Thứ Bảy' },
] as const;

const COMMON_TIMEZONES = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'UTC'] as const;

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
    publishTimezone: channelScheduleEditor(channel.publishSchedule).timezone,
    publishSlots: channelScheduleEditor(channel.publishSchedule).slots,
    publishNotes: channelScheduleEditor(channel.publishSchedule).notes,
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
  const youtubeSetupQuery = useYoutubeSetupStatus();
  const createMutation = useCreateChannel();
  const updateMutation = useUpdateChannel();
  const deleteMutation = useDeleteChannel();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<ChannelEditor>(EMPTY_EDITOR);
  const [pendingDelete, setPendingDelete] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [youtubeImportError, setYoutubeImportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const { pending: importPending, openPopup: openImportPopup } = useYoutubeOauthPopup((payload: YoutubeOauthFinishedMessage) => {
    if (!payload.success) {
      setYoutubeImportError('Google không hoàn tất việc thêm kênh. Hãy thử đăng nhập lại.');
      return;
    }
    setYoutubeImportError(null);
    setNotice(youtubeImportResultSummary({ imported: payload.imported ?? 0, alreadyBound: payload.alreadyBound, failed: payload.failed }));
    void selectImportedProfile(payload);
  });

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

  function mayDiscardEditor(channelId?: string): boolean {
    if (!editingId || editingId !== channelId) return true;
    const saved = channelsQuery.data?.find((channel) => channel.id === editingId);
    const dirty = saved ? isChannelEditorDirty(editor, editorFromChannel(saved)) : false;
    if (!profileRefreshNeedsConfirmation(dirty)) return true;
    return window.confirm('Bạn có thay đổi hồ sơ chưa lưu. Tiếp tục sẽ thay nội dung đang sửa bằng thông tin vừa tải từ YouTube. Bạn muốn tiếp tục?');
  }

  async function refreshEditorFromProfile(channelId: string) {
    const refreshed = await channelsQuery.refetch();
    const updated = refreshed.data?.find((channel) => channel.id === channelId);
    if (updated && editingId === channelId) setEditor(editorFromChannel(updated));
  }

  async function selectImportedProfile(payload: YoutubeOauthFinishedMessage) {
    const firstId = payload.profileIds?.[0];
    const refreshed = await channelsQuery.refetch();
    const first = firstId ? refreshed.data?.find((channel) => channel.id === firstId) : undefined;
    if (!first || !mayDiscardEditor(editingId ?? undefined)) return;
    editChannel(first);
  }

  async function importFromYoutube() {
    setYoutubeImportError(null);
    setNotice(null);
    try {
      await openImportPopup(beginYoutubeImport);
    } catch (caught) {
      setYoutubeImportError(caught instanceof Error ? caught.message : 'Không thể bắt đầu đăng nhập Google.');
    }
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

  function updatePublishSlot(index: number, patch: Partial<PublishSchedule['slots'][number]>) {
    setEditor((current) => ({
      ...current,
      publishSlots: current.publishSlots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot),
    }));
  }

  function applyStarterSchedule() {
    const starter = starterScheduleEditor();
    setEditor((current) => ({
      ...current,
      publishTimezone: starter.timezone,
      publishSlots: starter.slots,
      publishNotes: starter.notes,
    }));
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
              <div className={styles.headerActions}>
                <Button size="sm" onClick={startNew} disabled={busy}>Tạo kênh</Button>
                <div className={styles.importControl}>
                  <Button size="sm" variant="amber" onClick={() => void importFromYoutube()} disabled={busy || importPending || youtubeSetupQuery.data?.configured !== true}>
                    {importPending ? 'Đang chờ Google…' : 'Thêm kênh từ YouTube'}
                  </Button>
                  <p className={styles.muted}>Google quyết định kênh nào được liệt kê. Cần thêm kênh khác? Bấm lại và chọn kênh khác khi đăng nhập.</p>
                  {youtubeSetupQuery.data?.configured === false && <p className={styles.muted}>{youtubeSetupQuery.data.message}</p>}
                  {youtubeSetupQuery.isError && <p className={styles.muted}>Không kiểm tra được cấu hình Google. Hãy tải lại trang.</p>}
                </div>
              </div>
            </div>
            {notice && <p className={styles.notice} role="status">{notice}</p>}
            {youtubeImportError && <p className={styles.error} role="alert">{youtubeImportError}</p>}
            {channelsQuery.isLoading && <p className={styles.muted}>Đang tải danh sách kênh…</p>}
            {channelsQuery.error && <p className={styles.error} role="alert">Không tải được danh sách kênh.</p>}
            <div className={styles.channelList}>
              {(channelsQuery.data ?? []).map((channel) => (
                <article className={`${styles.channelItem} ${editingId === channel.id ? styles.selected : ''}`} key={channel.id}>
                  <div className={styles.channelName}><strong>{channel.name}</strong>{channel.handle && <span>{channel.handle}</span>}</div>
                  {channel.tagline && <p>{channel.tagline}</p>}
                  <ChannelYoutubeControls
                    channel={channel}
                    beforeProfileRefresh={() => mayDiscardEditor(channel.id)}
                    onProfileRefreshed={() => refreshEditorFromProfile(channel.id)}
                  />
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
                <fieldset className={styles.scheduleSection}>
                  <legend>Lịch đăng gợi ý</legend>
                  <label className={styles.field}>Múi giờ IANA
                    <input list="channel-publish-timezones" value={editor.publishTimezone} onChange={(event) => updateEditor('publishTimezone', event.target.value)} placeholder="Asia/Ho_Chi_Minh" />
                    <datalist id="channel-publish-timezones">{COMMON_TIMEZONES.map((timezone) => <option value={timezone} key={timezone} />)}</datalist>
                  </label>
                  <p className={styles.scheduleHint}>Gợi ý, chưa kiểm chứng; hãy chỉnh theo số liệu YouTube Studio của kênh. Mẫu: video dài {PUBLISH_SCHEDULE_STARTER_WINDOWS.long}, video ngắn {PUBLISH_SCHEDULE_STARTER_WINDOWS.short}.</p>
                  <div className={styles.slotRows}>
                    {editor.publishSlots.map((slot, index) => (
                      <div className={styles.slotRow} key={`${index}-${slot.weekday}-${slot.time}-${slot.kind}`}>
                        <label className={styles.field}>Thứ
                          <select aria-label={`Thứ của khung giờ ${index + 1}`} value={slot.weekday} onChange={(event) => updatePublishSlot(index, { weekday: Number(event.target.value) })}>
                            {WEEKDAYS.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}
                          </select>
                        </label>
                        <label className={styles.field}>Giờ
                          <input aria-label={`Giờ của khung giờ ${index + 1}`} type="time" step={60} value={slot.time} onChange={(event) => updatePublishSlot(index, { time: event.target.value })} />
                        </label>
                        <label className={styles.field}>Loại video
                          <select aria-label={`Loại video của khung giờ ${index + 1}`} value={slot.kind} onChange={(event) => updatePublishSlot(index, { kind: event.target.value as 'long' | 'short' })}>
                            <option value="long">Dài</option><option value="short">Ngắn</option>
                          </select>
                        </label>
                        <Button type="button" size="sm" onClick={() => updateEditor('publishSlots', editor.publishSlots.filter((_item, slotIndex) => slotIndex !== index))}>Xóa</Button>
                      </div>
                    ))}
                  </div>
                  <div className={styles.actions}>
                    <Button type="button" size="sm" onClick={() => updateEditor('publishSlots', [...editor.publishSlots, { weekday: 1, time: '09:00', kind: 'long' }])} disabled={editor.publishSlots.length >= 14}>Thêm khung giờ</Button>
                    <Button type="button" size="sm" onClick={applyStarterSchedule}>Dùng gợi ý ban đầu (giả thuyết)</Button>
                  </div>
                  <label className={styles.field}>Ghi chú lịch đăng<textarea maxLength={500} value={editor.publishNotes} onChange={(event) => updateEditor('publishNotes', event.target.value)} /></label>
                </fieldset>
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
