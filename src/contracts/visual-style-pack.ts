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
    slot("core", "Nhân vật (chính)", "Chỉ huy mặc giáp đứng trên đồi nhìn xuống thung lũng.", STYLE_BLOCKS["cinematic"], "Medium shot of a commander in plain period armor on a hilltop at overcast midday, looking across a valley, soft natural light."),
    slot("wide", "Toàn cảnh", "Thung lũng sông và đồn xa trong nắng thấp.", STYLE_BLOCKS["cinematic"], "Wide establishing shot of a river valley at low sun with a distant fortified settlement, long shadows, atmospheric haze."),
    slot("interior", "Nội thất", "Hai sĩ quan xem bản đồ trong lều nến.", STYLE_BLOCKS["cinematic"], "Interior of a candle-lit command tent, two officers leaning over a table with a plain map, window light on faces, shallow depth of field."),
    slot("night", "Đêm / hành động", "Binh lính vượt chỗ cạn lúc chạng vạng với đuốc.", STYLE_BLOCKS["cinematic"], "Soldiers crossing a shallow ford at dusk, torches and firelight reflected in the water, low angle, dust and smoke."),
    slot("props", "Vật dụng", "Thư niêm phong, ấn đồng và mũ trên bàn gỗ.", STYLE_BLOCKS["cinematic"], "Close-up of a sealed letter, a bronze seal and a helmet on a worn wooden table, side light, very shallow depth of field."),
  ],
  "anime": [
    slot("core", "Nhân vật (chính)", "Chỉ huy anime mặc giáp trên đồi, áo choàng bay.", STYLE_BLOCKS["anime"], "Medium shot of a commander in plain period armor on a hilltop, wind in the cape, looking across a valley, soft daylight, expressive determined face."),
    slot("wide", "Toàn cảnh", "Thung lũng sông và đồn xa trong cảnh nền chi tiết.", STYLE_BLOCKS["anime"], "Wide establishing shot of a river valley with a fortified settlement and a few small figures on a road, detailed painted-style background, clear sky."),
    slot("interior", "Nội thất", "Hai sĩ quan bên bản đồ trong lều đèn ấm.", STYLE_BLOCKS["anime"], "Interior of a command tent with two officers at a table with a plain map, warm lantern glow, one officer's face in close emphasis."),
    slot("night", "Đêm / hành động", "Binh lính vượt sông lúc chạng vạng với đuốc.", STYLE_BLOCKS["anime"], "Dynamic low-angle shot of soldiers crossing a river at dusk with torches, strong diagonal composition, motion lines in the water, dramatic orange and blue contrast."),
    slot("props", "Vật dụng", "Thư niêm phong, ấn đồng và mũ trên bàn.", STYLE_BLOCKS["anime"], "Still-life close-up of a sealed letter, a bronze seal and a helmet on a table, clean linework, soft rim light."),
  ],
  "watercolor": [
    slot("core", "Nhân vật (chính)", "Chỉ huy màu nước trên đồi nhìn xuống thung lũng.", STYLE_BLOCKS["watercolor"], "Medium shot of a commander in plain period armor on a hilltop looking across a valley, loose washes, calm overcast mood."),
    slot("wide", "Toàn cảnh", "Thung lũng xa và đồn tan vào sương.", STYLE_BLOCKS["watercolor"], "Very wide valley landscape with a distant fortified settlement dissolving into mist, large soft washes, a few tiny figures."),
    slot("interior", "Nội thất", "Hai người cúi xem bản đồ trong lều đèn ấm.", STYLE_BLOCKS["watercolor"], "Interior of a tent with two figures bending over a table, warm lantern wash against cool shadows, loose edges."),
    slot("night", "Đêm / hành động", "Binh lính vượt sông lúc chạng vạng, đuốc loang màu.", STYLE_BLOCKS["watercolor"], "Soldiers crossing a river at dusk, torchlight glowing as warm blooms of pigment into deep blue washes, expressive brush strokes."),
    slot("props", "Vật dụng", "Tĩnh vật thư, ấn và mũ với nhiều giấy trắng.", STYLE_BLOCKS["watercolor"], "Loose still life of a sealed letter, a seal and a helmet on a table, plenty of bare paper, delicate pigment bleeding."),
  ],
  "photorealistic": [
    slot("core", "Nhân vật (chính)", "Người mặc giáp lịch sử trên sườn đồi dưới trời âm u.", STYLE_BLOCKS["photorealistic"], "Medium shot of a man in plain historical armor standing on a hillside in flat overcast light, natural skin texture, 50mm lens look."),
    slot("wide", "Toàn cảnh", "Ảnh phong cảnh thung lũng sông và đồn xa.", STYLE_BLOCKS["photorealistic"], "Wide landscape photograph of a river valley with a small fortified settlement in the distance, natural afternoon light, 24mm lens look."),
    slot("interior", "Nội thất", "Hai người bên bản đồ trong lều vải có đèn.", STYLE_BLOCKS["photorealistic"], "Interior of a canvas tent lit by one lantern and daylight through the opening, two men at a table with a plain map, 35mm lens look."),
    slot("night", "Đêm / hành động", "Binh lính lội sông lúc chạng vạng dưới đuốc.", STYLE_BLOCKS["photorealistic"], "Group of soldiers wading a shallow river at dusk by torchlight, low angle, motion in the water, high-ISO photographic grain."),
    slot("props", "Vật dụng", "Cận cảnh thư niêm phong, ấn đồng và mũ cũ.", STYLE_BLOCKS["photorealistic"], "Macro-style photograph of a sealed letter, a bronze seal and a worn helmet on a wooden table, natural window light."),
  ],
  "flat-cartoon": [
    slot("core", "Nhân vật (chính)", "Chỉ huy hoạt hình trên đồi dưới trời âm u.", STYLE_BLOCKS["flat-cartoon"], "Medium shot of a single commander in plain period armor standing on a hilltop, looking across a valley, calm overcast daylight, figure left of center."),
    slot("wide", "Toàn cảnh", "Thung lũng sông rộng, đồn xa và vài người trên đường.", STYLE_BLOCKS["flat-cartoon"], "Very wide establishing shot of a river valley with a small fortified settlement far away and a few tiny figures on a road, deep perspective, empty foreground."),
    slot("interior", "Nội thất", "Hai sĩ quan bàn bản đồ trong lều dưới đèn ấm.", STYLE_BLOCKS["flat-cartoon"], "Interior of a command tent: a large table with a plain map covered in small markers, two officers in discussion, warm lantern light, medium-close composition."),
    slot("night", "Đêm / hành động", "Binh lính vượt chỗ cạn lúc chạng vạng với đuốc.", STYLE_BLOCKS["flat-cartoon"], "Low-angle dramatic shot of soldiers crossing a shallow ford at dusk, torches and firelight, motion in the water, strong diagonal composition."),
    slot("props", "Vật dụng", "Thư niêm phong, ấn đồng, cờ và mũ trên bàn gỗ.", STYLE_BLOCKS["flat-cartoon"], "Still-life close-up on a wooden table: a sealed letter, a bronze seal, a folded banner and a helmet, shallow depth, no readable text."),
  ],
  "strategic-map": [
    slot("core", "Nhân vật (chính)", "Chỉ huy cách điệu bên bàn với nét mặt tự tin.", STYLE_BLOCKS["strategic-map"], "Medium shot of a commander at a table with a confident, exaggerated expression, simplified character, plain background."),
    slot("map", "Bản đồ", "Bản đồ hai vùng màu, sông, đồi và mũi tên tiến quân.", STYLE_BLOCKS["strategic-map"], "Top-down tactical map with two color-coded territories, a river and hills, and directional arrows showing one force advancing; no labels."),
    slot("map-alt", "Bản đồ 2", "Bản đồ hai phe hội tụ tại chỗ vượt sông.", STYLE_BLOCKS["strategic-map"], "Top-down tactical map where two factions' arrows converge on a river crossing, different terrain layout from the previous map; no labels."),
    slot("combat", "Giao tranh", "Hai phe giao tranh bằng hình khối và màu rõ ràng.", STYLE_BLOCKS["strategic-map"], "Wide shot of simplified figures and effects in battle on a plain, bold shapes, clear factions by color, exaggerated shocked expressions."),
    slot("infographic", "Ẩn dụ tài nguyên", "Ẩn dụ nguồn lực bằng hai đống bao tải chênh lệch.", STYLE_BLOCKS["strategic-map"], "Tangible metaphor of resources: tall stacks of sacks on one side and a small pile on the other, flat colors, no numbers or text."),
  ],
};

export const VisualStylePackSlotIdSchema = z.string();
export function isVisualStylePackSlot(styleId: VisualStyleId, slotId: string): boolean {
  return VISUAL_STYLE_PACK_SLOTS[styleId].some((candidate) => candidate.id === slotId);
}

export const VisualStylePacksSchema = z.partialRecord(z.enum(VISUAL_STYLE_IDS), z.partialRecord(z.string(), VisualStyleSampleSchema));
export type VisualStylePacks = z.infer<typeof VisualStylePacksSchema>;
