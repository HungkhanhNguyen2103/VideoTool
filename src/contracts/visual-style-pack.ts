import { z } from 'zod';
import { VISUAL_STYLE_IDS, type VisualStyleId } from './project';
import { VisualStyleSampleSchema } from './visual-style-sample';

export type VisualStylePackSlot = { id: string; label: string; hint: string; prompt: string };

const STYLE_BLOCKS: Record<VisualStyleId, string> = {
  "cinematic": "A still frame from a high-end cinematic historical documentary: naturalistic but dramatic lighting (window light, firelight, overcast sky, low sun), shallow depth of field, muted desaturated color grading, photographic texture in fabric, metal, dust and skin. Favor wide and medium compositions. No readable text, no logos, no real-person likeness.",
  "anime": "A clean modern anime illustration: confident linework, expressive but readable faces, cel-shaded color blocks and a cohesive palette. Clear silhouettes and a purposeful focal point, with backgrounds and props detailed enough to carry the period and setting. No readable text, no logos.",
  "watercolor": "A soft watercolor painting on textured paper: visible brush strokes, transparent layered washes, gentle pigment variation and natural bleeding at the edges, unpainted paper showing where the light falls. Atmospheric composition that preserves key forms and mood. No readable text, no logos.",
  "photorealistic": "A documentary-style photograph: true-to-life color, physically plausible available light, accurate materials and natural skin and surface texture, captured on a real camera with a believable lens, depth and perspective. No illustration, no stylization, no heavy color grading, no glamour lighting. No readable text, no logos, no real-person likeness.",
  "flat-cartoon": "A flat, cel-shaded cartoon illustration with bold clean black outlines, flat color fills and only minimal, simple shadow blocks; no photorealistic lighting, textures or gradients. Characters have slightly chibi-like proportions with somewhat oversized heads, simplified expressive faces and compact bodies. Muted, desaturated earthy palette of olive greens, tans, browns and dusty blues. No readable text, no logos.",
  "strategic-map": "A 2D vector illustration with flat colors, bold clean outlines, flat lighting and minimal shadow; no photorealistic lighting, complex shading or gradients. Earth-tone terrain (greens, browns, tans, muted blues for water) and distinct solid colors for each faction. Simplified characters with highly exaggerated, readable facial expressions. No readable text or numbers, no logos.",
};

function slot(id: string, label: string, hint: string, styleBlock: string, subject: string): VisualStylePackSlot {
  return { id, label, hint, prompt: `${styleBlock} ${subject}` };
}

export const VISUAL_STYLE_PACK_SLOTS: Record<VisualStyleId, readonly VisualStylePackSlot[]> = {
  "cinematic": [
    slot("core", "Nhân vật (chính)", "Một người mặc quần áo giản dị đứng trên đồi nhìn xuống thung lũng.", STYLE_BLOCKS["cinematic"], "Medium shot of a person in plain everyday clothing standing on a hilltop at overcast midday, looking across a valley, soft natural light."),
    slot("wide", "Toàn cảnh", "Thung lũng sông với vài ngôi nhà nhỏ ở xa trong nắng thấp.", STYLE_BLOCKS["cinematic"], "Wide establishing shot of a river valley at low sun with a few small distant buildings, long shadows, atmospheric haze."),
    slot("interior", "Nội thất", "Hai người bên bàn gỗ có cuộn giấy trong căn phòng ánh nến.", STYLE_BLOCKS["cinematic"], "Interior of a plain candle-lit room, two people in everyday clothing leaning over a wooden table with a rolled paper, window light on faces, shallow depth of field."),
    slot("night", "Đêm / hành động", "Nhóm người vượt chỗ cạn lúc chạng vạng, ánh lửa bên bờ.", STYLE_BLOCKS["cinematic"], "A small group of people crossing a shallow river at dusk, firelight on the bank reflected in the water, low angle, dust and smoke."),
    slot("props", "Vật dụng", "Cuộn giấy, đèn dầu, hộp gỗ và cuộn dây thừng trên bàn gỗ.", STYLE_BLOCKS["cinematic"], "Close-up of a rolled paper, an oil lantern, a wooden box and a coil of rope on a worn wooden table, side light, very shallow depth of field."),
  ],
  "anime": [
    slot("core", "Nhân vật (chính)", "Một người mặc đồ giản dị trên đồi, gió thổi, nét mặt quyết tâm.", STYLE_BLOCKS["anime"], "Medium shot of a person in plain everyday clothing on a hilltop, wind in their clothes, looking across a valley, soft daylight, expressive determined face."),
    slot("wide", "Toàn cảnh", "Thung lũng sông, vài nhà nhỏ và vài người trên đường, nền chi tiết.", STYLE_BLOCKS["anime"], "Wide establishing shot of a river valley with a few small buildings and a few small figures on a road, detailed painted-style background, clear sky."),
    slot("interior", "Nội thất", "Hai người bên bàn gỗ trong phòng đèn ấm, một khuôn mặt được nhấn mạnh.", STYLE_BLOCKS["anime"], "Interior of a plain room with two people at a wooden table with a rolled paper, warm lantern glow, one person's face in close emphasis."),
    slot("night", "Đêm / hành động", "Nhóm người vượt sông lúc chạng vạng bên ánh lửa, bố cục chéo.", STYLE_BLOCKS["anime"], "Dynamic low-angle shot of a group of people crossing a river at dusk by firelight, strong diagonal composition, motion lines in the water, dramatic orange and blue contrast."),
    slot("props", "Vật dụng", "Cuộn giấy, đèn dầu và hộp gỗ trên bàn.", STYLE_BLOCKS["anime"], "Still-life close-up of a rolled paper, an oil lantern and a wooden box on a table, clean linework, soft rim light."),
  ],
  "watercolor": [
    slot("core", "Nhân vật (chính)", "Một người mặc đồ giản dị trên đồi nhìn xuống thung lũng, nét loang.", STYLE_BLOCKS["watercolor"], "Medium shot of a person in plain clothing on a hilltop looking across a valley, loose washes, calm overcast mood."),
    slot("wide", "Toàn cảnh", "Thung lũng xa, vài nhà nhỏ tan vào sương.", STYLE_BLOCKS["watercolor"], "Very wide valley landscape with a few small distant buildings dissolving into mist, large soft washes, a few tiny figures."),
    slot("interior", "Nội thất", "Hai người cúi bên bàn trong phòng đèn ấm.", STYLE_BLOCKS["watercolor"], "Interior of a plain room with two figures bending over a table, warm lantern wash against cool shadows, loose edges."),
    slot("night", "Đêm / hành động", "Nhóm người vượt sông lúc chạng vạng, ánh lửa loang trong nền xanh đậm.", STYLE_BLOCKS["watercolor"], "A group of people crossing a river at dusk, firelight glowing as warm blooms of pigment into deep blue washes, expressive brush strokes."),
    slot("props", "Vật dụng", "Tĩnh vật cuộn giấy, đèn dầu, hộp gỗ với nhiều giấy trắng.", STYLE_BLOCKS["watercolor"], "Loose still life of a rolled paper, an oil lantern and a wooden box on a table, plenty of bare paper, delicate pigment bleeding."),
  ],
  "photorealistic": [
    slot("core", "Nhân vật (chính)", "Một người mặc đồ giản dị trên sườn đồi dưới trời âm u.", STYLE_BLOCKS["photorealistic"], "Medium shot of a person in plain everyday clothing standing on a hillside in flat overcast light, natural skin texture, 50mm lens look."),
    slot("wide", "Toàn cảnh", "Ảnh phong cảnh thung lũng sông với vài nhà nhỏ ở xa.", STYLE_BLOCKS["photorealistic"], "Wide landscape photograph of a river valley with a few small distant buildings, natural afternoon light, 24mm lens look."),
    slot("interior", "Nội thất", "Hai người bên bàn gỗ trong phòng có đèn và ánh sáng cửa sổ.", STYLE_BLOCKS["photorealistic"], "Interior of a plain room lit by one lantern and daylight through the window, two people at a wooden table with a rolled paper, 35mm lens look."),
    slot("night", "Đêm / hành động", "Nhóm người lội sông lúc chạng vạng bên ánh lửa.", STYLE_BLOCKS["photorealistic"], "Group of people wading a shallow river at dusk by firelight, low angle, motion in the water, high-ISO photographic grain."),
    slot("props", "Vật dụng", "Cận cảnh cuộn giấy, đèn dầu và hộp gỗ trên bàn.", STYLE_BLOCKS["photorealistic"], "Macro-style photograph of a rolled paper, an oil lantern and a wooden box on a wooden table, natural window light."),
  ],
  "flat-cartoon": [
    slot("core", "Nhân vật (chính)", "Một nhân vật mặc đồ giản dị đứng trên đồi dưới trời âm u.", STYLE_BLOCKS["flat-cartoon"], "Medium shot of a single person in plain everyday clothing standing on a hilltop, looking across a valley, calm overcast daylight, figure left of center."),
    slot("wide", "Toàn cảnh", "Thung lũng sông rộng, vài nhà ở xa và vài người trên đường.", STYLE_BLOCKS["flat-cartoon"], "Very wide establishing shot of a river valley with a few small buildings far away and a few tiny figures on a road, deep perspective, empty foreground."),
    slot("interior", "Nội thất", "Hai người bàn chuyện bên bàn gỗ có cuộn giấy và đèn.", STYLE_BLOCKS["flat-cartoon"], "Interior of a plain room: a large wooden table with a rolled paper and a lantern, two people in discussion, warm lantern light, medium-close composition."),
    slot("night", "Đêm / hành động", "Nhóm người vượt chỗ cạn lúc chạng vạng bên ánh lửa.", STYLE_BLOCKS["flat-cartoon"], "Low-angle dramatic shot of a group of people crossing a shallow river at dusk, firelight on the bank, motion in the water, strong diagonal composition."),
    slot("props", "Vật dụng", "Cuộn giấy, đèn dầu, hộp gỗ và dây thừng trên bàn gỗ.", STYLE_BLOCKS["flat-cartoon"], "Still-life close-up on a wooden table: a rolled paper, an oil lantern, a wooden box and a coil of rope, shallow depth, no readable text."),
  ],
  "strategic-map": [
    slot("core", "Nhân vật (chính)", "Một nhân vật cách điệu bên bàn với nét mặt tự tin.", STYLE_BLOCKS["strategic-map"], "Medium shot of a person at a table with a confident, exaggerated expression, simplified character, plain background."),
    slot("map", "Bản đồ", "Bản đồ hai vùng màu, sông, đồi và mũi tên tiến quân.", STYLE_BLOCKS["strategic-map"], "Top-down tactical map with two color-coded territories, a river and hills, and directional arrows showing one force advancing; no labels."),
    slot("map-alt", "Bản đồ 2", "Bản đồ hai phe hội tụ tại chỗ vượt sông.", STYLE_BLOCKS["strategic-map"], "Top-down tactical map where two factions' arrows converge on a river crossing, different terrain layout from the previous map; no labels."),
    slot("combat", "Giao tranh", "Hai bên va chạm bằng hình khối và màu rõ ràng.", STYLE_BLOCKS["strategic-map"], "Wide shot of simplified figures and effects clashing on a plain, bold shapes, clear sides by color, exaggerated shocked expressions."),
    slot("infographic", "Ẩn dụ tài nguyên", "Ẩn dụ nguồn lực bằng hai đống bao tải chênh lệch.", STYLE_BLOCKS["strategic-map"], "Tangible metaphor of resources: tall stacks of sacks on one side and a small pile on the other, flat colors, no numbers or text."),
  ],
};

export const VisualStylePackSlotIdSchema = z.string();
export function isVisualStylePackSlot(styleId: VisualStyleId, slotId: string): boolean {
  return VISUAL_STYLE_PACK_SLOTS[styleId].some((candidate) => candidate.id === slotId);
}

export const VisualStylePacksSchema = z.partialRecord(z.enum(VISUAL_STYLE_IDS), z.partialRecord(z.string(), VisualStyleSampleSchema));
export type VisualStylePacks = z.infer<typeof VisualStylePacksSchema>;
