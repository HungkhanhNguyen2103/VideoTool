import { stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../shared/errors';

export const RENDER_ESTIMATED_OUTPUT_BYTES_PER_SECOND = 3 * 1024 * 1024;
export const RENDER_DISK_HEADROOM_FACTOR = 1.25;
export const RENDER_DISK_RESERVE_BYTES = 1024 ** 3;

export type RenderDiskUsageInput = {
  durationSeconds: number;
  mediaAssetBytes: number;
  normalizedSfxBytes: number;
  engine: 'ffmpeg' | 'remotion';
  hasBgm: boolean;
  renderAndStoreShareVolume: boolean;
  renderAndStageShareVolume: boolean;
};

export type RenderDiskUsageEstimate = {
  outputBytes: number;
  renderVolumeRequiredBytes: number;
  remotionStageVolumeRequiredBytes: number;
  storeCopyVolumeRequiredBytes: number;
};

function addHeadroom(bytes: number): number {
  return bytes === 0 ? 0 : Math.ceil(bytes * RENDER_DISK_HEADROOM_FACTOR) + RENDER_DISK_RESERVE_BYTES;
}

export function estimateRenderDiskUsage(input: RenderDiskUsageInput): RenderDiskUsageEstimate {
  const outputBytes = Math.ceil(Math.max(0, input.durationSeconds) * RENDER_ESTIMATED_OUTPUT_BYTES_PER_SECOND);
  const outputCopies = input.engine === 'ffmpeg' ? (input.hasBgm ? 3 : 2) : 1;
  const stageBytes = input.engine === 'remotion' ? Math.max(0, input.mediaAssetBytes) + Math.max(0, input.normalizedSfxBytes) : 0;
  let renderBytes = outputBytes * outputCopies + (input.engine === 'ffmpeg' ? Math.max(0, input.normalizedSfxBytes) : 0);
  if (input.engine === 'remotion' && input.renderAndStageShareVolume) renderBytes += stageBytes;

  return {
    outputBytes,
    renderVolumeRequiredBytes: addHeadroom(renderBytes),
    remotionStageVolumeRequiredBytes: input.engine === 'remotion' && !input.renderAndStageShareVolume ? addHeadroom(stageBytes) : 0,
    storeCopyVolumeRequiredBytes: input.renderAndStoreShareVolume ? 0 : addHeadroom(outputBytes),
  };
}

export type DiskSpaceRequirement = { path: string; label: string; requiredBytes: number };
export type DiskSpaceProbe = (directory: string) => Promise<{ device: string; availableBytes: number }>;
export type DiskSpaceVolume = { device: string; path: string; labels: string[]; requiredBytes: number; availableBytes: number };
export type InsufficientDiskSpace = DiskSpaceVolume & { error: AppError };

async function nearestExistingDirectory(directory: string): Promise<string> {
  let candidate = path.resolve(directory);
  while (true) {
    try {
      const stats = await stat(candidate);
      if (!stats.isDirectory()) throw new Error(`Disk-space path is not a directory: ${candidate}`);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function probeRenderDiskSpace(directory: string): Promise<{ device: string; availableBytes: number }> {
  const existingDirectory = await nearestExistingDirectory(directory);
  const [stats, disk] = await Promise.all([stat(existingDirectory), statfs(existingDirectory)]);
  return { device: String(stats.dev), availableBytes: disk.bavail * disk.bsize };
}

export async function inspectRenderDiskSpace(
  requirements: readonly DiskSpaceRequirement[],
  probe: DiskSpaceProbe = probeRenderDiskSpace,
): Promise<{ volumes: DiskSpaceVolume[]; insufficient: InsufficientDiskSpace[] }> {
  const volumesByDevice = new Map<string, DiskSpaceVolume>();
  for (const requirement of requirements) {
    if (requirement.requiredBytes <= 0) continue;
    const info = await probe(requirement.path);
    const existing = volumesByDevice.get(info.device);
    if (existing) {
      existing.requiredBytes += requirement.requiredBytes;
      existing.availableBytes = Math.min(existing.availableBytes, info.availableBytes);
      existing.labels.push(requirement.label);
    } else {
      volumesByDevice.set(info.device, {
        device: info.device,
        path: requirement.path,
        labels: [requirement.label],
        requiredBytes: requirement.requiredBytes,
        availableBytes: info.availableBytes,
      });
    }
  }
  const volumes = [...volumesByDevice.values()];
  const insufficient = volumes
    .filter((volume) => volume.availableBytes < volume.requiredBytes)
    .map((volume) => ({
      ...volume,
      error: new AppError(
        `Không đủ dung lượng trống để render. Ước tính cần ${formatGiB(volume.requiredBytes)} GiB tại ${volume.path}, hiện còn ${formatGiB(volume.availableBytes)} GiB. Hãy dọn ổ đĩa trước khi chạy render.`,
        507,
        'INSUFFICIENT_RENDER_DISK_SPACE',
      ),
    }));
  return { volumes, insufficient };
}

export function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2);
}
