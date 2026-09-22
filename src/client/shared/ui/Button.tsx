import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'ghost' | 'amber' | 'indigoline' | 'red';
type Size = 'md' | 'sm' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
};

const SIZE_CLASS: Record<Size, string | undefined> = { md: undefined, sm: styles.sm, lg: styles.lg };

export function Button({ variant = 'ghost', size = 'md', busy, className, type = 'button', ...rest }: ButtonProps) {
  const cls = [styles.btn, styles[variant], SIZE_CLASS[size], className].filter(Boolean).join(' ');
  return <button type={type} className={cls} aria-busy={busy || undefined} {...rest} />;
}
