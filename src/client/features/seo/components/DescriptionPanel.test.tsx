import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptySeoPackage } from '../../../../contracts/seo';
import type { ProjectDetail } from '../../../../contracts/project';
import { DescriptionPanel } from './DescriptionPanel';

describe('DescriptionPanel', () => {
  it('shows the assembled word count, soft hint, and editable keywords field', () => {
    const project = { language: 'vi' } as ProjectDetail;
    const seo = { ...emptySeoPackage(), descriptionKeywords: 'Từ khóa mô tả.' };
    const html = renderToStaticMarkup(<DescriptionPanel
      project={project}
      seo={seo}
      description="Một mô tả đã lắp ghép."
      busy={false}
      onPatch={() => undefined}
      onRegenerate={() => undefined}
      onFlush={() => undefined}
    />);

    expect(html).toContain('6 từ');
    expect(html).toContain('gợi ý 150–300 từ, chưa kiểm chứng');
    expect(html).toContain('aria-label="Từ khóa mô tả"');
    expect(html).toContain('maxLength="800"');
    expect(html).toContain('Từ khóa mô tả.');
  });
});
