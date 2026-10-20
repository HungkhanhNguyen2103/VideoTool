import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { estimateRenderDiskUsage, inspectRenderDiskSpace, type DiskSpaceRequirement } from './render-disk-preflight';

describe('render disk preflight', () => {
  it('estimates output, renderer working copies, staged media, and an EXDEV store copy', () => {
    const estimate = estimateRenderDiskUsage({
      durationSeconds: 3_600,
      mediaAssetBytes: 2_000_000_000,
      normalizedSfxBytes: 100_000_000,
      engine: 'remotion',
      hasBgm: false,
      renderAndStoreShareVolume: false,
      renderAndStageShareVolume: false,
    });

    expect(estimate.outputBytes).toBe(3_600 * 3 * 1024 * 1024);
    expect(estimate.remotionStageVolumeRequiredBytes).toBeGreaterThan(2_100_000_000);
    expect(estimate.storeCopyVolumeRequiredBytes).toBeGreaterThan(estimate.outputBytes);
    expect(estimate.renderVolumeRequiredBytes).toBeGreaterThan(estimate.outputBytes);
  });

  it('groups paths by device and reports insufficient disk space in Vietnamese', async () => {
    const requirements: DiskSpaceRequirement[] = [
      { path: 'render-volume', label: 'Render', requiredBytes: 300 },
      { path: 'store-volume', label: 'EXDEV copy', requiredBytes: 250 },
      { path: 'same-render-volume', label: 'Remotion staging', requiredBytes: 250 },
    ];
    const inspected = await inspectRenderDiskSpace(requirements, async (directory) => ({
      device: directory === 'store-volume' ? 'store' : 'render',
      availableBytes: directory === 'store-volume' ? 200 : 600,
    }));

    expect(inspected.volumes).toHaveLength(2);
    expect(inspected.insufficient).toHaveLength(1);
    expect(inspected.insufficient[0]?.error).toBeInstanceOf(AppError);
    expect(inspected.insufficient[0]?.error.message).toContain('Không đủ dung lượng trống để render');
  });
});
