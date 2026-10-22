import { YoutubeRetentionCurveSchema, type YoutubeRetentionCurve } from '../src/contracts/youtube';
import { SceneDocSchema } from '../src/server/modules/project/docs';

export function makeYoutubeReviewDemoScenes() {
  return [
    SceneDocSchema.parse({ id: 'review-scene-1', narration: 'Mở đầu đặt câu hỏi về nguyên nhân khiến cuộc vây hãm kéo dài.', visualPrompt: 'Mở đầu: bản đồ thành cổ lúc bình minh', durationSec: 120 }),
    SceneDocSchema.parse({ id: 'review-scene-2', narration: 'Cảnh này giải thích tuyến tiếp tế và quyết định làm thay đổi cục diện.', visualPrompt: 'Tuyến tiếp tế trên bản đồ thành cổ', durationSec: 120 }),
    SceneDocSchema.parse({ id: 'review-scene-3', narration: 'Những ghi chép còn lại cho thấy nguồn lương thực dần cạn.', visualPrompt: 'Kho lương cạn dần trong thành', durationSec: 120 }),
    SceneDocSchema.parse({ id: 'review-scene-4', narration: 'Hai phía chuyển sang thương lượng sau nhiều tuần giằng co.', visualPrompt: 'Sứ giả gặp nhau ngoài cổng thành', durationSec: 120 }),
    SceneDocSchema.parse({ id: 'review-scene-5', narration: 'Kết thúc nêu điều có thể rút ra và câu hỏi còn bỏ ngỏ.', visualPrompt: 'Tàn tích thành cổ trong ánh chiều', durationSec: 120 }),
  ];
}

export function makeYoutubeReviewDemoRetentionCurve(): YoutubeRetentionCurve {
  return YoutubeRetentionCurveSchema.parse(Array.from({ length: 101 }, (_unused, index) => ({
    ratio: index / 100,
    watchRatio: index < 35 ? 0.9 : index === 35 ? 0.6 : Math.max(0.08, 0.59 - (index - 35) * 0.002),
  })));
}
