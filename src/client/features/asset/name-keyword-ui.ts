import type { PopupPlanPopup } from '../../../contracts/popup-analysis';

export function nameKeywordPopupLine(popup: PopupPlanPopup | null | undefined): string {
  if (!popup) return 'Popup tên: —';
  const type = popup.kind === 'place' ? 'địa danh' : popup.kind === 'person' ? 'người' : popup.kind === 'event' ? 'sự kiện' : 'tên riêng';
  return `Popup tên: ${popup.display} (${type} · AI)`;
}
