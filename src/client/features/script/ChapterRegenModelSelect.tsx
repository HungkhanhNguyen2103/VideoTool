import { AI_MODEL_REGISTRY } from '../../../contracts/ai-models';
import type { AiProvider } from '../../../contracts/project';
import { AiModelSelect } from '../../shared/ai/AiModelSelect';
import type { ClaudeCliModelId } from './generation-mode';

type ChapterRegenModelSelectProps = {
  mode: 'automatic' | 'cli' | 'manual';
  provider: AiProvider;
  model: string;
  cliModel: ClaudeCliModelId;
  disabled?: boolean;
  className?: string;
  fieldClassName?: string;
  selectClassName?: string;
  onModelChange: (model: string) => void;
  onCliModelChange: (model: ClaudeCliModelId) => void;
};

type ChapterRegenModelHelpProps = {
  text: string;
  isStatus: boolean;
  className?: string;
};

export function ChapterRegenModelSelect({
  mode,
  provider,
  model,
  cliModel,
  disabled = false,
  className,
  fieldClassName,
  selectClassName,
  onModelChange,
  onCliModelChange,
}: ChapterRegenModelSelectProps) {
  return <div className={className}>
    {mode === 'cli' ? <label className={fieldClassName} htmlFor="claude-cli-model">Model Claude CLI
      <select className={selectClassName} id="claude-cli-model" value={cliModel} disabled={disabled} onChange={(event) => onCliModelChange(event.target.value as ClaudeCliModelId)}>
        {AI_MODEL_REGISTRY.claude.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label> : <AiModelSelect
      provider={provider}
      value={model}
      mode={mode === 'manual' ? 'manual' : 'automatic'}
      disabled={disabled}
      showCostNote={false}
      className={fieldClassName}
      selectClassName={selectClassName}
      onChange={onModelChange}
    />}
  </div>;
}

export function ChapterRegenModelHelp({ text, isStatus, className }: ChapterRegenModelHelpProps) {
  return <small className={className} title={text} aria-label={text} role={isStatus ? 'status' : undefined} aria-live="polite">
    {text}
  </small>;
}
