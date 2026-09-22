import { AppError } from '../../shared/errors';
import type { VideoRenderer } from './ffmpeg-renderer';

export class RemotionRenderer implements VideoRenderer {
  async renderScenePreview(): Promise<Buffer> {
    throw new AppError('Remotion render engine is not yet implemented.', 501, 'RENDER_ENGINE_NOT_IMPLEMENTED');
  }

  async renderFullVideo(): Promise<Buffer> {
    throw new AppError('Remotion render engine is not yet implemented.', 501, 'RENDER_ENGINE_NOT_IMPLEMENTED');
  }
}
