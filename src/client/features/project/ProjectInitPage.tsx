import { useState } from 'react';
import type { ProjectImportSeed } from '../../../contracts/project';
import { NewProjectForm } from './components/NewProjectForm';
import { RecentProjects } from './components/RecentProjects';
import styles from './ProjectInitPage.module.css';

export function ProjectInitPage() {
  const [prefill, setPrefill] = useState<ProjectImportSeed | null>(null);
  return (
    <div className={styles.grid}>
      <NewProjectForm prefill={prefill} onPrefillApplied={() => setPrefill(null)} />
      <RecentProjects onImportSeed={setPrefill} />
    </div>
  );
}
