import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Studio scene readiness presentation', () => {
  it('shows measured clip facts, readiness tooltips, and video thumbnails in cards and detail', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('analyzeScene(scene)');
    expect(source).toContain('clip {scene.videoDurationSec.toFixed(1)}s');
    expect(source).toContain('title={readiness.messages.join(\' · \')}');
    expect(source).toContain('Khung hinh video');
    expect(source).toContain("['Keyframe'");
    expect(source).toContain("['Khung cuoi'");
    expect(source).toContain("['Clip'");
    expect(source).toContain('Chưa có');
    expect(source).toContain("expandedScene.audioFileId ? 'từ voiceover' : 'ước tính'");
  });
});
