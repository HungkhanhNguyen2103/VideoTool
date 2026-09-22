import styles from './ComingSoonPage.module.css';

export function ComingSoonPage({ title, phase }: { title: string; phase: number }) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.text}>Màn hình này sẽ được dựng ở Phase {phase}.</p>
    </section>
  );
}
