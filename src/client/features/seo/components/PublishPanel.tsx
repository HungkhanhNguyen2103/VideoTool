import { useState } from 'react';
import type { FileSummary } from '../../../../contracts/file';
import type { ProjectDetail } from '../../../../contracts/project';
import type { Channel } from '../../../../contracts/channel';
import { formatSlotLabel, nextPublishSlots, PUBLISH_LEAD_HOURS_MAX, PUBLISH_LEAD_HOURS_MIN } from '../../../../contracts/channel-schedule';
import { buildPublishChecklist } from '../../../../contracts/seo-format';
import { fileUrlForSummary } from '../../asset/api';
import { Button } from '../../../shared/ui/Button';
import { copyPublishSlot } from '../publish-schedule';
import styles from '../SeoPage.module.css';

type Props = { project: ProjectDetail; thumbnailFile?: FileSummary; renderFile?: FileSummary; channel?: Channel; otherChannelTitles?: readonly string[]; now?: Date; onCopy: () => void; onDownload: () => void };

export function PublishPanel({ project, thumbnailFile, renderFile, channel, otherChannelTitles, now: providedNow, onCopy, onDownload }: Props) {
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const now = providedNow ?? new Date();
  const checklist = buildPublishChecklist(project, thumbnailFile, channel, {
    now,
    ...(otherChannelTitles === undefined ? {} : { otherChannelTitles }),
  });
  const assignedChannel = channel && channel.id === project.channelId ? channel : undefined;
  const schedule = assignedChannel?.publishSchedule;
  const slots = schedule ? nextPublishSlots(schedule, now, 'long', 3) : [];

  async function copySlot(instant: Date) {
    if (!schedule) return;
    const text = `${formatSlotLabel(instant, schedule.timezone)} (${schedule.timezone})`;
    const result = await copyPublishSlot(text, async (value) => {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
    });
    setFallbackText(result.fallbackText);
  }

  return <section className={styles.panel} aria-labelledby="seo-publish-title">
    <div className={styles.panelHead}><div><h2 id="seo-publish-title">Sẵn sàng đăng</h2><p className={styles.muted}>Kiểm tra lần cuối trước khi đưa video lên YouTube.</p></div><div className={styles.actions}><Button onClick={onCopy}>Sao chép tất cả</Button><Button variant="amber" onClick={onDownload}>Tải gói đăng (.md)</Button></div></div>
    <ul className={styles.checklist}>{checklist.map((item) => <li key={item.key} className={item.reminder ? styles.checkReminder : item.warning ? styles.checkWarning : item.done ? styles.checkDone : styles.checkPending}><span aria-hidden="true">{item.reminder ? 'i' : item.warning ? '!' : item.done ? '✓' : '○'}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></li>)}</ul>
    <section className={styles.publishSchedule} aria-labelledby="publish-schedule-title">
      <div className={styles.publishScheduleHead}><h3 id="publish-schedule-title">Lịch đăng gợi ý</h3><span>gợi ý, chưa kiểm chứng; hãy chỉnh theo số liệu YouTube Studio của kênh</span></div>
      {!assignedChannel || !schedule || slots.length === 0
        ? <p className={styles.muted}>Kênh chưa có lịch đăng video dài; mở Quản lý kênh nếu muốn thêm khung giờ.</p>
        : <>
          <p className={styles.muted}>Múi giờ: {schedule.timezone}</p>
          <ul className={styles.publishSlots}>{slots.map((slot, index) => {
            const label = `${formatSlotLabel(slot, schedule.timezone)} (${schedule.timezone})`;
            return <li className={styles.publishSlot} key={`${slot.toISOString()}-${index}`}>
              <span>{label}</span>
              <Button size="sm" onClick={() => void copySlot(slot)}>Sao chép giờ</Button>
            </li>;
          })}</ul>
          {fallbackText && <div className={styles.copyFallback} role="status">
            <p>Không thể sao chép tự động. Hãy chọn và sao chép giờ đăng bên dưới.</p>
            <input aria-label="Giờ đăng gợi ý để sao chép thủ công" readOnly value={fallbackText} onFocus={(event) => event.currentTarget.select()} />
          </div>}
        </>}
      <ol className={styles.publishWorkflow}>
        <li>Tải video lên ở chế độ không công khai hoặc đặt lịch sớm khoảng {PUBLISH_LEAD_HOURS_MIN}–{PUBLISH_LEAD_HOURS_MAX} giờ trước giờ đăng (gợi ý, chưa kiểm chứng) để YouTube xử lý và kiểm tra bản quyền.</li>
        <li>Điền tiêu đề, mô tả, tags, thumbnail và playlist.</li>
        <li>Đặt lịch hoặc công khai đúng giờ.</li>
      </ol>
    </section>
    <div className={styles.publishLinks}>
      {renderFile ? <a href={fileUrlForSummary(renderFile)} download>⬇ Tải video render</a> : <span className={styles.muted}>Chưa có link video render</span>}
      {thumbnailFile ? <a href={fileUrlForSummary(thumbnailFile)} download>⬇ Tải thumbnail</a> : <span className={styles.muted}>Chưa có link thumbnail</span>}
    </div>
  </section>;
}
