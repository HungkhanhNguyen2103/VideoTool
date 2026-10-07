export const LANDSCAPE_NAME_LOWER_THIRD_MARGIN_BOTTOM = 0.17;
export const PORTRAIT_NAME_LOWER_THIRD_MARGIN_BOTTOM = 0.21;
const LANDSCAPE_NAME_LOWER_THIRD_MAX_WIDTH = 0.78;
const PORTRAIT_NAME_LOWER_THIRD_MAX_WIDTH = 0.82;
const NAME_LOWER_THIRD_LEFT_MARGIN = 0.06;

export type NameLowerThirdLayout = { left: number; bottom: number; maxWidth: number };

export function nameLowerThirdLayout(width: number, height: number): NameLowerThirdLayout {
  const portrait = width / height < 0.8;
  return {
    left: width * NAME_LOWER_THIRD_LEFT_MARGIN,
    bottom: height * (portrait ? PORTRAIT_NAME_LOWER_THIRD_MARGIN_BOTTOM : LANDSCAPE_NAME_LOWER_THIRD_MARGIN_BOTTOM),
    maxWidth: width * (portrait ? PORTRAIT_NAME_LOWER_THIRD_MAX_WIDTH : LANDSCAPE_NAME_LOWER_THIRD_MAX_WIDTH),
  };
}
