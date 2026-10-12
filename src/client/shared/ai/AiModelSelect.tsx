import { AI_MODEL_REGISTRY, getDefaultAiModelId } from '../../../contracts/ai-models';
import type { AiProvider } from '../../../contracts/project';

type AiModelSelectProps = {
  provider: AiProvider;
  value?: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  mode?: 'automatic' | 'manual';
  showCostNote?: boolean;
  className?: string;
  selectClassName?: string;
};

export function aiModelForProviderChange(nextProvider: AiProvider, currentProvider: AiProvider, currentModel?: string): string {
  if (nextProvider === currentProvider && currentModel && AI_MODEL_REGISTRY[nextProvider].models.some((model) => model.id === currentModel)) {
    return currentModel;
  }
  return getDefaultAiModelId(nextProvider);
}

export function AiModelSelect({ provider, value, onChange, disabled = false, mode = 'automatic', showCostNote = true, className, selectClassName }: AiModelSelectProps) {
  if (mode === 'manual') return null;
  const models = AI_MODEL_REGISTRY[provider].models;
  const selected = models.some((model) => model.id === value) ? value! : getDefaultAiModelId(provider);
  return <div className={className}>
    <label htmlFor="ai-model-select">Model</label>
    <select id="ai-model-select" className={selectClassName} aria-label="Model AI" value={selected} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {models.map((model) => <option key={model.id} value={model.id}>{model.label} — {model.hint}</option>)}
    </select>
    {showCostNote && <small>Chi phí xem trên dashboard của Claude/DeepSeek.</small>}
  </div>;
}
