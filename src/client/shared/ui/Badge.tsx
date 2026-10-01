import type { ReactNode } from 'react';
import styles from './Badge.module.css';

type BadgeTone = 'green' | 'red' | 'amber' | 'indigo' | 'muted';

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
