import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'ghost' | 'amber' | 'indigo' | 'indigoline' | 'red' | 'green';
type Size = 'md' | 'sm' | 'lg' | 'icon';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  /** Pressed/toggled-on styling for a compact icon button (prototype's `.btn--icon.is-on`). */
  active?: boolean;
};

const SIZE_CLASS: Record<Size, string | undefined> = { md: undefined, sm: styles.sm, lg: styles.lg, icon: styles.icon };

export function Button({ variant = 'ghost', size = 'md', busy, active, className, type = 'button', ...rest }: ButtonProps) {
  const cls = [styles.btn, styles[variant], SIZE_CLASS[size], active && styles.isOn, className].filter(Boolean).join(' ');
  return <button type={type} className={cls} aria-busy={busy || undefined} {...rest} />;
}
