export type LogoLayout = { width: number; height: number; right: number; bottom: number };
export const LOGO_OPACITY = 0.25;

export function logoLayout(width: number, height: number): LogoLayout {
  const minDimension = Math.min(width, height);
  const size = minDimension * 0.18;
  const margin = minDimension * 0.04;
  return { width: size, height: size, right: margin, bottom: margin };
}
