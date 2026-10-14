import type { KeyboardEvent } from 'react';
import styles from './StudioPage.module.css';

export type SceneActiveToggleProps = {
  active: boolean;
  disabled: boolean;
  accessibleName: string;
  label?: string;
  hint?: string;
  compact?: boolean;
  onChange: (active: boolean) => void;
};

export function SceneActiveToggle({ active, disabled, accessibleName, label, hint, compact = false, onChange }: SceneActiveToggleProps) {
  const hintId = hint ? `${accessibleName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-hint` : undefined;
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!disabled && !event.repeat) onChange(!active);
  }

  return <div className={`${styles.sceneActiveToggle} ${compact ? styles.sceneActiveToggleCompact : ''}`}>
    {label && <span className={styles.sceneActiveLabel}>{label}</span>}
    <button
      type="button"
      className={styles.sceneActiveSwitch}
      role="switch"
      aria-label={accessibleName}
      aria-checked={active}
      aria-describedby={hintId}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!active); }}
      onKeyDown={handleKeyDown}
    ><span className={styles.sceneActiveSwitchTrack} aria-hidden="true"><span className={styles.sceneActiveSwitchThumb} /></span><span>{active ? 'Bật' : 'Tắt'}</span></button>
    {hint && <span className={styles.sceneActiveHint} id={hintId}>{hint}</span>}
  </div>;
}
