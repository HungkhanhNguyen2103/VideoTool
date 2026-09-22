import styles from './Toast.module.css';
import { useToastStore } from './toast-store';

export function Toast() {
  const message = useToastStore((s) => s.message);
  return (
    <div className={`${styles.toast} ${message ? styles.visible : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
