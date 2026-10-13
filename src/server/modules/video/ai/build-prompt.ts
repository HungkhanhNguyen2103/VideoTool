import type { PopupDensity } from '../../../../contracts/popup-analysis';
import { loadPopupPreset } from './presets/loader';

export type PopupPromptScene = { scene: number; startSec: number; narration: string };
export type PopupPromptInput = {
  title: string;
  brief: string;
  referencesText: string;
  language: 'vi' | 'en';
  density: PopupDensity;
  scenes: readonly PopupPromptScene[];
  primarySceneNumbers?: readonly number[];
};

const DENSITY_GUIDANCE: Record<PopupDensity, string> = {
  low: 'chỉ những dữ kiện người xem không thể theo dõi nếu thiếu popup; mục tiêu khoảng tối đa một popup mỗi 15–20 giây, thường ít hơn',
  medium: 'thêm ngữ cảnh hữu ích ngoài những dữ kiện bắt buộc, nhưng vẫn tránh trang trí thừa',
  high: 'rộng rãi hơn với các dữ kiện hữu ích, nhưng vẫn phải có lý do người xem cần chữ trên màn hình',
};

export function buildPopupAnalysisPrompt(input: PopupPromptInput): string {
  const preset = loadPopupPreset();
  const scenes = input.scenes.map((scene) => `Scene ${scene.scene} · bắt đầu ${scene.startSec.toFixed(2)}s\n${scene.narration}`).join('\n\n');
  return [
    `POPUP_PROMPT_ID=${preset.id}@${preset.version}`,
    preset.system,
    preset.instructions,
    `Mật độ ${input.density}: ${DENSITY_GUIDANCE[input.density]}.`,
    'Các loại popup: person, place, event, number, year, date. Trả về {"scenes":[...]} với verdict cho mọi scene; popup phải có anchor là các từ liên tiếp nguyên văn trong narration.',
    `Tiêu đề dự án: ${input.title}`,
    `Brief:\n${input.brief}`,
    `Tài liệu tham khảo:\n${input.referencesText}`,
    `Ngôn ngữ: ${input.language}`,
    ...(input.primarySceneNumbers ? [`PRIMARY SCENES ONLY: ${input.primarySceneNumbers.join(', ')}. Return verdicts only for these primary scenes; other scenes are context.`] : []),
    'NARRATION SCENES:',
    scenes,
  ].join('\n\n');
}
