import type { Scene, ProjectDetail } from '../../../contracts/project';
import { Button } from '../../shared/ui/Button';
import styles from './StudioPage.module.css';
import { createScenePreviewFingerprint, scenePreviewStaleReason, scenePreviewStatusText, type ScenePreviewFingerprint } from './scene-preview';

export type ScenePreviewState = {
  url: string;
  renderedAt: number;
  fingerprint: ScenePreviewFingerprint;
};

type ScenePreviewSectionProps = {
  scene: Scene;
  currentScene?: Scene;
  sceneNumber: number;
  project: ProjectDetail;
  preview: ScenePreviewState | null;
  error: string | null;
  studioLocked: boolean;
  onRender: () => void;
};

function descriptionForEngine(engine: ProjectDetail['renderEngine']): string {
  return engine === 'remotion'
    ? 'Voiceover/SFX + hiệu ứng Remotion + logo nếu có; không có BGM. Scene đơn, không có chuyển cảnh.'
    : 'Chỉ có asset + voiceover/SFX; bỏ hiệu ứng Remotion và logo.';
}

export function ScenePreviewSection({ scene, currentScene = scene, sceneNumber, project, preview, error, studioLocked, onRender }: ScenePreviewSectionProps) {
  const currentFingerprint = createScenePreviewFingerprint(currentScene, project);
  const staleReason = preview ? scenePreviewStaleReason(preview.fingerprint, currentFingerprint) : null;

  return <section className={styles.scenePreviewSection} aria-labelledby={`scene-preview-title-${scene.id}`}>
    <div className={styles.scenePreviewHeader}>
      <div>
        <h3 id={`scene-preview-title-${scene.id}`} className={styles.scenePreviewTitle}>Preview render</h3>
        <p className={styles.muted}>{descriptionForEngine(project.renderEngine)}</p>
      </div>
      <span className={styles.previewEngine}>{project.renderEngine === 'remotion' ? 'Remotion' : 'FFmpeg'}</span>
    </div>
    {preview ? <video className={styles.scenePreviewPlayer} controls src={preview.url} aria-label={`Preview render scene ${sceneNumber}`} /> : <div className={styles.scenePreviewEmpty}>Chưa có preview render cho scene này.</div>}
    {preview && <p className={styles.scenePreviewStatus}>{scenePreviewStatusText(preview.renderedAt, currentScene.durationSec, project.renderEngine)}</p>}
    {staleReason && <p className={styles.scenePreviewStale} aria-live="polite">Preview có thể đã cũ · {staleReason}</p>}
    {error && <p className={styles.scenePreviewError} role="alert">{error}</p>}
    <div className={styles.scenePreviewActions}>
      <Button size="sm" variant="amber" disabled={studioLocked} onClick={onRender}>{preview ? 'Render lại preview' : 'Render preview'}</Button>
      {preview && <span className={styles.muted}>Preview chỉ lưu trong phiên này; tải lại trang sẽ mất.</span>}
    </div>
  </section>;
}
