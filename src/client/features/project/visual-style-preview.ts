import cinematicPreview from '../../assets/visual-style-previews/cinematic.jpg';
import type { VisualStyleId } from '../../../contracts/project';
import type { VisualStyleSamples } from '../../../contracts/visual-style-sample';

export type VisualStylePreview = { src: string; alt: string; filename: string };

const BUNDLED_PREVIEWS: Partial<Record<VisualStyleId, VisualStylePreview>> = {
  cinematic: {
    src: cinematicPreview,
    alt: 'Ảnh mẫu phong cách Cinematic',
    filename: 'cinematic-style-preview.jpg',
  },
};

export function resolveVisualStylePreview(styleId: VisualStyleId, samples: VisualStyleSamples | undefined): VisualStylePreview | undefined {
  const sample = samples?.[styleId];
  return sample
    ? { src: sample.url, alt: `Ảnh mẫu phong cách ${styleId}`, filename: sample.filename }
    : BUNDLED_PREVIEWS[styleId];
}
