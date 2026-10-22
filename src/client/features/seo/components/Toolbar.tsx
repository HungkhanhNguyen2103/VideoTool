import type { SeoSection } from '../../../../contracts/seo';
import styles from '../SeoPage.module.css';
import { Button } from '../../../shared/ui/Button';
import { AiModelSelect } from '../../../shared/ai/AiModelSelect';
import { AI_MODEL_REGISTRY } from '../../../../contracts/ai-models';
import { SEO_CLI_NOTE, type SeoGenerationAvailability } from '../seo-generation-mode';

type Props = {
  mode: 'automatic' | 'manual';
  provider: 'deepseek' | 'claude';
  model?: string;
  backend: 'api' | 'cli';
  cliModel: string;
  cliAvailability: SeoGenerationAvailability;
  busy: boolean;
  sections: SeoSection[];
  hasRaw: boolean;
  onModeChange: (mode: 'automatic' | 'manual') => void;
  onProviderChange: (provider: 'deepseek' | 'claude') => void;
  onModelChange: (model: string) => void;
  onBackendChange: (backend: 'api' | 'cli') => void;
  onCliModelChange: (model: string) => void;
  onGenerate: () => void;
  onLoadPrompt: () => void;
  onImport: () => void;
};

export function Toolbar({ mode, provider, model, backend, cliModel, cliAvailability, busy, sections, hasRaw, onModeChange, onProviderChange, onModelChange, onBackendChange, onCliModelChange, onGenerate, onLoadPrompt, onImport }: Props) {
  const modeSelector = <label className={`${styles.field} ${styles.modeField}`}>
    <span>Chế độ</span>
    <select className={styles.input} value={mode} onChange={(event) => onModeChange(event.target.value as Props['mode'])} disabled={busy}>
      <option value="automatic">Tự động</option>
      <option value="manual">Thủ công (JSON)</option>
    </select>
  </label>;

  return (
    <div className={styles.toolbar}>
      {mode === 'automatic' ? <>
        <div className={styles.toolbarControls}>
          {modeSelector}
          <label className={`${styles.field} ${styles.backendField}`}>
            <span>Cách sinh</span>
            <select className={styles.input} value={backend} onChange={(event) => onBackendChange(event.target.value as Props['backend'])} disabled={busy}>
              <option value="api">API</option>
              <option value="cli">Claude CLI</option>
            </select>
          </label>
          {backend === 'api' && <label className={`${styles.field} ${styles.providerField}`}>
            <span>AI</span>
            <select className={styles.input} value={provider} onChange={(event) => onProviderChange(event.target.value as Props['provider'])} disabled={busy}>
              <option value="deepseek">DeepSeek</option>
              <option value="claude">Claude</option>
            </select>
          </label>}
          {backend === 'api' ? <AiModelSelect className={`${styles.modelSelect} ${styles.apiModelSelect}`} selectClassName={styles.input} provider={provider} value={model} disabled={busy} showCostNote={false} onChange={onModelChange} /> : (
            <label className={`${styles.modelSelect} ${styles.cliModelSelect}`} htmlFor="seo-cli-model">
              <span>Model Claude CLI</span>
              <select id="seo-cli-model" className={styles.input} value={cliModel} disabled={busy} onChange={(event) => onCliModelChange(event.target.value)}>
                {AI_MODEL_REGISTRY.claude.models.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.hint}</option>)}
              </select>
            </label>
          )}
          <Button className={styles.generateButton} variant="amber" onClick={onGenerate} disabled={busy || cliAvailability.disabled} busy={busy} title={cliAvailability.reason}>Tạo toàn bộ gói</Button>
        </div>
        {backend === 'cli' && <div className={styles.toolbarNote}>
          <small className={styles.cliNote}>{SEO_CLI_NOTE}</small>
          {cliAvailability.disabled && <small className={styles.cliNote} role="status">{cliAvailability.reason}</small>}
        </div>}
      </> : <div className={styles.toolbarManual}>
        {modeSelector}
        <Button onClick={onLoadPrompt} disabled={busy} busy={busy}>Sao chép prompt</Button>
        <Button onClick={onImport} disabled={busy || !hasRaw} title={!hasRaw ? 'Dán JSON trước.' : undefined}>Nhập JSON</Button>
        <span className={styles.toolbarHint}>Các phần: {sections.length}/6</span>
        <span className={styles.providerHint}>Tự dán JSON từ AI bất kỳ</span>
      </div>}
    </div>
  );
}
