import { z } from 'zod';
import type { PopupDensity } from '../../../../contracts/popup-analysis';
import { loadPopupPreset } from './presets/loader';
import { PopupAiOutputSchema } from './output-schema';
import { activeScenes } from '../../../../contracts/scene-active';

export type PopupPromptScene = { scene: number; startSec: number; narration: string; active?: boolean };
export type PopupPromptInput = {
  title: string;
  brief: string;
  referencesText: string;
  language: 'vi' | 'en';
  density: PopupDensity;
  scenes: readonly PopupPromptScene[];
  primarySceneNumbers?: readonly number[];
};

export const POPUP_AI_OUTPUT_JSON_SCHEMA = z.toJSONSchema(PopupAiOutputSchema) as Record<string, unknown>;

const POPUP_AI_OUTPUT_EXAMPLE = {
  scenes: [
    { scene: 12, needed: true, reason: 'Quy mô lực lượng là mốc người xem cần nhớ.', popups: [{ scene: 12, kind: 'number', anchor: 'ba nghìn người', display: '3.000 người', importance: 5, reason: 'Nêu quy mô lực lượng.' }] },
    { scene: 13, needed: false, reason: 'Không có mốc mới đủ quan trọng để hiện chữ.', popups: [] },
  ],
};

const DENSITY_GUIDANCE: Record<PopupDensity, string> = {
  low: 'chỉ những dữ kiện người xem không thể theo dõi nếu thiếu popup; mục tiêu khoảng tối đa một popup mỗi 15–20 giây, thường ít hơn',
  medium: 'thêm ngữ cảnh hữu ích ngoài những dữ kiện bắt buộc, nhưng vẫn tránh trang trí thừa',
  high: 'rộng rãi hơn với các dữ kiện hữu ích, nhưng vẫn phải có lý do người xem cần chữ trên màn hình',
};

export function buildPopupAnalysisPrompt(input: PopupPromptInput): string {
  const preset = loadPopupPreset();
  const scenes = activeScenes(input.scenes).map((scene) => `Scene ${scene.scene} · bắt đầu ${scene.startSec.toFixed(2)}s\n${scene.narration}`).join('\n\n');
  return [
    `POPUP_PROMPT_ID=${preset.id}@${preset.version}`,
    preset.system,
    preset.instructions,
    `Mật độ ${input.density}: ${DENSITY_GUIDANCE[input.density]}.`,
    'Các loại popup: person, place, event, number, year, date. Dùng đúng các key trong schema, không thêm key khác. Mỗi PRIMARY scene phải xuất hiện đúng một lần; trường scene là số ngay sau chữ Scene. Popup phải có anchor là các từ liên tiếp nguyên văn trong narration. Với kind number, display chỉ được có một con số duy nhất kèm danh từ (ví dụ "3.000 quân"), tuyệt đối không hiển thị khoảng số hoặc hai mốc.',
    `EXACT JSON SCHEMA: ${JSON.stringify(POPUP_AI_OUTPUT_JSON_SCHEMA)}`,
    `COMPACT JSON EXAMPLE: ${JSON.stringify(POPUP_AI_OUTPUT_EXAMPLE)}`,
    `Tiêu đề dự án: ${input.title}`,
    `Brief:\n${input.brief}`,
    `Tài liệu tham khảo:\n${input.referencesText}`,
    `Ngôn ngữ: ${input.language}`,
    ...(input.primarySceneNumbers ? [`PRIMARY SCENES ONLY: ${input.primarySceneNumbers.join(', ')}. Return verdicts only for these primary scenes; other scenes are context.`] : []),
    'NARRATION SCENES:',
    scenes,
  ].join('\n\n');
}
