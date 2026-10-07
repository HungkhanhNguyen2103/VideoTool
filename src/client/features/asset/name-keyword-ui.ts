import type { AiProvider, Scene } from '../../../contracts/project';
import { areNameCandidatesFresh } from '../../../contracts/name-keywords';
import type { NameKeywordPopupPreview } from './api';

const PROVIDER_LABELS: Record<AiProvider, string> = { deepseek: 'DeepSeek', claude: 'Claude' };

export function nameKeywordStatusText(scenes: readonly Scene[]): string {
  const records = scenes.flatMap((scene) => scene.nameCandidates ? [{
    scene,
    record: scene.nameCandidates,
    fresh: areNameCandidatesFresh(scene.nameCandidates, scene.narration, scene.audioFileId),
  }] : []);
  const freshRecords = records.filter(({ fresh }) => fresh);
  const staleCount = records.length - freshRecords.length;
  const unanalysedCount = scenes.length - records.length;
  const summary = `Tên popup: Có kết quả mới: ${freshRecords.length} · Đã cũ: ${staleCount} · Chưa phân tích: ${unanalysedCount}`;
  if (freshRecords.length === 0) return summary;

  const latest = freshRecords.reduce((current, candidate) => candidate.record.generatedAt > current.record.generatedAt ? candidate : current);
  const withName = freshRecords.filter(({ record }) => record.candidates.length > 0).length;
  const updated = new Date(latest.record.generatedAt);
  const time = Number.isNaN(updated.getTime()) ? '' : updated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${summary} · AI (${PROVIDER_LABELS[latest.record.provider]}) · ${withName}/${freshRecords.length} scene có tên${time ? ` · cập nhật ${time}` : ''}`;
}

export function nameKeywordPopupLine(popup: NameKeywordPopupPreview | null | undefined): string {
  if (!popup) return 'Popup tên: —';
  const type = popup.type === 'place' ? 'địa danh' : popup.type === 'person' ? 'người' : 'tên riêng';
  const source = popup.source === 'ai' ? 'AI' : 'quy tắc';
  return `Popup tên: ${popup.text} (${type} · ${source})`;
}
