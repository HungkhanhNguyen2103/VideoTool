import type { ProjectSummary } from '../../../../contracts/project';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Icon } from '../../../shared/ui/Icon';
import { PROJECT_STATUS_META, relativeTime } from '../format';
import styles from './ProjectCard.module.css';

type ProjectCardProps = {
  project: ProjectSummary;
  isCurrent: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function ProjectCard({ project, isCurrent, onOpen, onDuplicate, onDelete }: ProjectCardProps) {
  const status = PROJECT_STATUS_META[project.status];
  const meta = [project.scenesCount != null ? `${project.scenesCount} cảnh • ${project.durationSec}s` : null, relativeTime(project.updatedAt)]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className={`${styles.card} ${isCurrent ? styles.current : ''}`}>
      <div className={styles.top}>
        <h3 className={styles.title}>{project.title}</h3>
        <div className={styles.badges}>
          <Badge tone={status.tone}>{status.label}</Badge>
          {isCurrent && <Badge tone="amber">Đang mở</Badge>}
        </div>
      </div>
      <div className={styles.meta}>{meta}</div>
      <div className={styles.actions}>
        <Button size="sm" onClick={onOpen} disabled={isCurrent}>
          <Icon name="folder" />
          {isCurrent ? 'Đang mở' : 'Mở'}
        </Button>
        <Button size="sm" onClick={onDuplicate} aria-label={`Nhân bản ${project.title}`}>
          <Icon name="copy" />
          Nhân bản
        </Button>
        <Button size="sm" variant="red" onClick={onDelete} aria-label={`Xóa ${project.title}`}>
          <Icon name="trash" />
          Xóa
        </Button>
      </div>
    </li>
  );
}
