import type { ClaudeCliStatus } from '../../../contracts/script';

export const SEO_CLI_NOTE = 'Dùng Claude Code đã đăng nhập trên máy; chậm hơn API (thường 1–3 phút) và có thể bị giới hạn lượt gọi.';

export type SeoGenerationAvailability = { disabled: boolean; reason?: string };

export function seoGenerationAvailability(backend: 'api' | 'cli', status?: ClaudeCliStatus, statusError?: string): SeoGenerationAvailability {
  if (backend === 'api') return { disabled: false, reason: undefined };
  if (!status) return { disabled: true, reason: statusError ?? 'Đang kiểm tra khả dụng của Claude CLI.' };
  if (!status.available) return { disabled: true, reason: status.reason ?? 'Claude Code CLI chưa khả dụng trên máy này.' };
  return { disabled: false, reason: undefined };
}
