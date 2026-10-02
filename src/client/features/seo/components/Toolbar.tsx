import type { SeoSection } from '../../../../contracts/seo';
import { AI_PROVIDER_LABELS } from '../seo-view';
import styles from '../SeoPage.module.css';
import { Button } from '../../../shared/ui/Button';

type Props = {
  mode: 'automatic' | 'manual';
  provider: 'deepseek' | 'claude';
  busy: boolean;
  sections: SeoSection[];
  hasRaw: boolean;
  onModeChange: (mode: 'automatic' | 'manual') => void;
  onProviderChange: (provider: 'deepseek' | 'claude') => void;
  onGenerate: () => void;
  onLoadPrompt: () => void;
  onImport: () => void;
};

export function Toolbar({ mode, provider, busy, sections, hasRaw, onModeChange, onProviderChange, onGenerate, onLoadPrompt, onImport }: Props) {
  return (
    <div className={styles.toolbar}>
      <label className={styles.field}>
        <span>Chế độ</span>
        <select className={styles.input} value={mode} onChange={(event) => onModeChange(event.target.value as Props['mode'])} disabled={busy}>
          <option value="automatic">Tự động</option>
          <option value="manual">Thủ công (JSON)</option>
        </select>
      </label>
      {mode === 'automatic' ? (
        <>
          <label className={styles.field}>
            <span>AI</span>
            <select className={styles.input} value={provider} onChange={(event) => onProviderChange(event.target.value as Props['provider'])} disabled={busy}>
              <option value="deepseek">DeepSeek</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <Button variant="amber" onClick={onGenerate} disabled={busy} busy={busy}>Tạo toàn bộ gói</Button>
        </>
      ) : (
        <>
          <Button onClick={onLoadPrompt} disabled={busy} busy={busy}>Sao chép prompt</Button>
          <Button onClick={onImport} disabled={busy || !hasRaw} title={!hasRaw ? 'Dán JSON trước.' : undefined}>Nhập JSON</Button>
          <span className={styles.toolbarHint}>Các phần: {sections.length}/5</span>
        </>
      )}
      <span className={styles.providerHint}>{mode === 'automatic' ? `Sinh bằng ${AI_PROVIDER_LABELS[provider]}` : 'Tự dán JSON từ AI bất kỳ'}</span>
    </div>
  );
}
