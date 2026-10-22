import { YoutubeGrowthPlanConfigSchema, type YoutubeGrowthPlanConfig, type YoutubeGrowthPlanStatus } from '../../../contracts/youtube-plan';

const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeZone: 'UTC' });

export function formatGrowthNumber(value: number | null | undefined, maximumFractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Chưa có dữ liệu';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(value);
}

export function formatGrowthDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Chưa có dữ liệu';
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? DATE.format(date) : 'Chưa có dữ liệu';
}

export function formatGrowthInterval(hitRate: YoutubeGrowthPlanStatus['hitRates']['first'], target: number): string {
  if (hitRate.count === 0) return 'Chưa có đủ video trưởng thành để ước lượng.';
  if (hitRate.hits === 0 && hitRate.count < 10) return 'Chưa có video nào đạt mốc; ước lượng chưa có ý nghĩa.';
  if (hitRate.videosUntilHit) return `Cần khoảng ${NUMBER.format(hitRate.videosUntilHit.min)}–${NUMBER.format(hitRate.videosUntilHit.max)} video nữa để có 1 video đạt ${formatGrowthNumber(target, 0)} lượt xem.`;
  if (hitRate.ruleOfThreeUpperBound !== null) return `Chưa có video đạt mốc ${formatGrowthNumber(target, 0)} lượt xem; cận trên xấp xỉ ${Math.round(hitRate.ruleOfThreeUpperBound * 100)}% theo quy tắc 3/n.`;
  return hitRate.message ?? 'Chưa có đủ dữ liệu để ước lượng.';
}

export function growthVerdictLabel(value: YoutubeGrowthPlanStatus['verdict']['verdict']): string {
  return ({ insufficient_data: 'Chưa đủ dữ liệu', continue: 'Tiếp tục', change_one_variable: 'Đổi một biến', consider_stop: 'Cân nhắc dừng ngách' })[value];
}

export function growthStageLabel(value: YoutubeGrowthPlanStatus['stage']['current']): string {
  return ({ A: 'A · Thu thập tín hiệu', B: 'B · Tìm mẫu lặp lại', C: 'C · Có tín hiệu tăng trưởng', D: 'D · Tăng quy mô', E: 'E · Đủ số liệu tham khảo' })[value];
}

export function checkpointStatusLabel(value: YoutubeGrowthPlanStatus['checkpoints'][number]['status']): string {
  return ({ upcoming: 'Sắp tới', reached: 'Đã tới mốc', passed: 'Đã qua' })[value];
}

export function growthProgress(actual: number | null, required: number): number | null {
  if (actual === null || !Number.isFinite(actual) || !Number.isFinite(required) || required <= 0) return null;
  return Math.max(0, Math.min(1, actual / required));
}

export function parseGrowthPlanForm(input: unknown): YoutubeGrowthPlanConfig {
  return YoutubeGrowthPlanConfigSchema.parse(input);
}
