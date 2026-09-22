import { NewProjectForm } from './components/NewProjectForm';
import { RecentProjects } from './components/RecentProjects';
import styles from './ProjectInitPage.module.css';

export function ProjectInitPage() {
  return (
    <div className={styles.grid}>
      <NewProjectForm />
      <RecentProjects />
    </div>
  );
}
