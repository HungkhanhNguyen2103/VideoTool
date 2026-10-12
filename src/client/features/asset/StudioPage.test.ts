import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Studio scene readiness presentation', () => {
  it('shows project name-popup status/action and a read-only selected popup in scene details', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('nameKeywordStatusText(scenes)');
    expect(source).toContain('Phân tích tên popup');
    expect(source).toContain("setBusy('name-keywords')");
    expect(source).toContain('namePopupPreviewsQuery');
    expect(source).toContain('nameKeywordPopupLine');
  });

  it('shows measured clip facts, readiness tooltips, and video thumbnails in cards and detail', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('analyzeScene(scene)');
    expect(source).toContain(' · clip ${scene.videoDurationSec.toFixed(1)}s');
    expect(source).toContain('title={readiness.messages.join(\' · \')}');
    expect(source).toContain('Khung hinh video');
    expect(source).toContain("['Keyframe'");
    expect(source).not.toContain("['Khung cuoi'");
    expect(source).toContain("['Clip'");
    expect(source).toContain('Chưa có');
    expect(source).toContain("expandedScene.audioFileId ? 'từ voiceover' : 'ước tính'");
    expect(source).toContain('Kéo dài scene = clip');
    expect(source).toContain('Tạo lại voiceover có thể hoàn tác thay đổi này');
    expect(source).toContain('api.fitSceneToClip(projectId, scene.id, project.version)');
    expect(source).toContain('{renderReadiness.total} scenes:');
    expect(source).toContain('renderReadiness.confirmations.length > 0');
    expect(source).toContain('Tiếp tục render');
    expect(source).toContain('Cảnh cảnh báo chỉ cần xác nhận');
    expect(source).toContain('disabled={studioLocked || missingScenes.length > 0}');
  });

  it('wires scene preview results into the detail section and labeled card fallback', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('ScenePreviewSection');
    expect(source).toContain('Đã render preview scene ${sceneNumber}.');
    expect(source).toContain('Preview render');
    expect(source).toContain('Xem asset gốc');
    expect(source).toContain('URL.revokeObjectURL(preview.url)');
  });

  it('shows editable scene tail and the unapplied-duration recompute action', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Khoảng nghỉ cuối scene (giây)');
    expect(source).toContain('Cộng thêm vào cuối mỗi voiceover. Áp dụng khi tạo voiceover mới hoặc bấm Tính lại thời lượng.');
    expect(source).toContain('Chưa áp dụng cho scene đã có voiceover — bấm Tính lại thời lượng');
    expect(source).toContain('Tính lại thời lượng theo voiceover');
    expect(source).toContain('hasUnappliedSceneTail');
    expect(source).toContain('api.recomputeSceneDurations(projectId)');
  });

  it('shows SFX asset counts and exposes missing-only retry after a failed batch result', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('SfxBatchSummarySchema.safeParse(progress.result)');
    expect(source).toContain('scenes.filter((scene) => scene.sfxFileId !== null).length');
    expect(source).toContain('scenes.filter((scene) => scene.sfxPrompt.trim().length > 0).length');
    expect(source).toContain('Tạo lại SFX còn thiếu');
    expect(source).toContain('api.generateAllSfx(projectId, true)');
    expect(source).toContain('disabled={studioLocked || !scenes.some((scene) => scene.sfxPrompt.trim() && !scene.sfxFileId)}');
  });

  it('exposes the fast-save SFX relative-volume control', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('SfxVolumeSchema.safeParse(Number(sfxVolumeDraft))');
    expect(source).toContain('Âm lượng SFX so với voiceover');
    expect(source).toContain('onBlur={() => void saveSfxVolume()}');
    expect(source).toContain('api.setSfxVolume(projectId, parsed.data)');
  });

  it('formats fractional scene durations with at most one decimal in Studio', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('formatDurationSeconds(scene.durationSec)');
    expect(source).toContain('formatDurationSeconds(expandedScene.durationSec)');
  });
});

describe('Studio control grid layout', () => {
  it('uses independent columns without forcing card heights to match', async () => {
    const css = await readFile(new URL('./StudioPage.module.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.controlGrid\s*\{[^}]*columns:\s*2/s);
    expect(css).toContain('break-inside: avoid;');
  });
});

describe('Studio configuration card structure', () => {
  it('keeps all four labeled cards and the render-engine group in the control grid', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('aria-labelledby="scene-controls-title"');
    expect(source).toContain('aria-labelledby="audio-controls-title"');
    expect(source).toContain('aria-labelledby="video-controls-title"');
    expect(source).toContain('aria-labelledby="render-controls-title"');
    expect(source).toContain('aria-label="Render engine"');
  });
});

describe('Studio verified control explanations', () => {
  it('explains the behavior and limits confirmed by the existing handlers', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('./StudioPage.module.css', import.meta.url), 'utf8');
    for (const explanation of [
      'Model AI dùng cho các tác vụ AI; phong cách chỉ áp dụng khi tạo visual prompt.',
      'JSON chứa số scene, visual/motion prompt và loại asset; ZIP ghép file theo số scene trong tên SCENE_###_....',
      'Đổi loại áp dụng cho tất cả scene; metadata riêng của loại cũ sẽ được làm mới.',
      'Xem trước trước khi áp dụng; scene đã có asset hoặc keyframe sẽ được giữ nguyên.',
      'Tách nhỏ dùng AI và bỏ qua chương đã có asset, voiceover, SFX hoặc visual prompt.',
      'Visual prompt bổ sung trường còn thiếu như visual và SFX; motion prompt chỉ tạo cho scene video.',
      'Tạo voiceover cho scene có lời dẫn; scene lỗi được ghi riêng.',
      'Căn thời gian chỉ cập nhật word timings cho voiceover WAV hiện có.',
      'SFX tìm trên Freesound theo prompt; scene không có prompt sẽ được bỏ qua.',
      'Tìm bản nhạc nền trên Freesound theo mood bạn nhập.',
      'FFmpeg bỏ qua hiệu ứng Remotion và logo; render nháp chỉ dùng được với Remotion.',
      'Các tùy chọn pop-up, chuyển cảnh, phim cũ và chiều sâu chỉ áp dụng với Remotion.',
      'Tạo depth map cho scene ảnh có asset; map cùng ảnh sẽ được giữ lại.',
      'Phân tích lời dẫn để gợi ý tên riêng và địa danh cho chữ pop-up.',
      'Bản nháp chỉ có trên Remotion và lưu riêng, không ghi đè bản render chính.',
    ]) expect(source).toContain(explanation);
    expect(css).toContain('.controlHelp {');
  });
});
describe('Studio compact control columns', () => {
  it('keeps the original scene, audio, video, render DOM order in independent CSS columns', async () => {
    const source = await readFile(new URL('./StudioPage.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('./StudioPage.module.css', import.meta.url), 'utf8');
    const cardOrder = [
      'aria-labelledby="scene-controls-title"',
      'aria-labelledby="audio-controls-title"',
      'aria-labelledby="video-controls-title"',
      'aria-labelledby="render-controls-title"',
    ].map((selector) => source.indexOf(selector));

    expect(cardOrder.every((position) => position >= 0)).toBe(true);
    expect(cardOrder).toEqual([...cardOrder].sort((a, b) => a - b));
    expect(css).toMatch(/\.controlGrid\s*\{[^}]*columns:\s*2/s);
    expect(css).toContain('break-inside: avoid;');
    expect(css).toMatch(/@media\s*\(max-width:\s*1099px\)\s*\{[^}]*\.controlGrid\s*\{[^}]*columns:\s*1/s);
  });
});
