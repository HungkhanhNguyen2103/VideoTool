import { useEffect, useState } from 'react';
import type { ProjectStatus } from '../../../../contracts/project';
import { Button } from '../../../shared/ui/Button';
import { Icon } from '../../../shared/ui/Icon';
import { toast } from '../../../shared/ui/toast-store';
import { useDeleteProject, useDuplicateProject, useProjects } from '../hooks';
import { useProjectUiStore } from '../store';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { ProjectCard } from './ProjectCard';
import styles from './RecentProjects.module.css';

const STATUS_OPTIONS: { value: 'all' | ProjectStatus; label: string }[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'draft', label: 'Nháp' },
  { value: 'script', label: 'Đã có kịch bản' },
  { value: 'assets', label: 'Đã có asset' },
  { value: 'rendered', label: 'Đã render' },
];

export function RecentProjects() {
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState<'all' | ProjectStatus>('all');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(queryInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const currentProjectId = useProjectUiStore((s) => s.currentProjectId);
  const setCurrentProjectId = useProjectUiStore((s) => s.setCurrentProjectId);
  const duplicateProject = useDuplicateProject();
  const deleteProject = useDeleteProject();

  const { data: allProjects } = useProjects({});
  const filtering = debouncedQuery !== '' || status !== 'all';
  const { data: filteredProjects } = useProjects({
    q: debouncedQuery || undefined,
    status: status === 'all' ? undefined : status,
  });

  const total = allProjects?.length ?? 0;
  const items = filteredProjects ?? [];
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  return (
    <section className={styles.panel} aria-labelledby="recent-title">
      <div className={styles.head}>
        <div>
          <h2 className={styles.ptitle} id="recent-title">
            <Icon name="list" />
            Dự án gần đây
          </h2>
          <div className="mono muted">{filtering ? `${items.length}/${total} dự án` : `${total} dự án`}</div>
        </div>
        <Button variant="indigoline" disabled title="Sắp có">
          <Icon name="upload" />
          Nhập từ ZIP
          <span className={styles.pill}>Sắp có</span>
        </Button>
      </div>

      <div className={styles.filters}>
        <div className={styles.search}>
          <Icon name="search" />
          <label className="sr-only" htmlFor="search">
            Tìm dự án
          </label>
          <input
            className={styles.input}
            id="search"
            type="search"
            placeholder="Tìm theo tên…"
            autoComplete="off"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
        </div>
        <label className="sr-only" htmlFor="status-filter">
          Lọc theo trạng thái
        </label>
        <select
          className={`${styles.input} ${styles.statusFilter}`}
          id="status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'all' | ProjectStatus)}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {items.length > 0 ? (
        <ul className={styles.list}>
          {items.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isCurrent={project.id === currentProjectId}
              onOpen={() => {
                setCurrentProjectId(project.id);
                toast(`Đã mở "${project.title}".`);
              }}
              onDuplicate={async () => {
                const copy = await duplicateProject.mutateAsync(project.id);
                toast(`Đã nhân bản thành "${copy.title}".`);
              }}
              onDelete={() => setPendingDelete({ id: project.id, title: project.title })}
            />
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          {total > 0 ? (
            <>
              <strong>Không có dự án khớp bộ lọc</strong>
              <Button
                size="sm"
                onClick={() => {
                  setQueryInput('');
                  setDebouncedQuery('');
                  setStatus('all');
                }}
              >
                Xóa bộ lọc
              </Button>
            </>
          ) : (
            <>
              <strong>Chưa có dự án nào</strong>
              <span>Tạo dự án đầu tiên ở form bên trái, hoặc nhập từ file ZIP.</span>
            </>
          )}
        </div>
      )}

      <ConfirmDeleteDialog
        pending={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const { id } = pendingDelete;
          setPendingDelete(null);
          await deleteProject.mutateAsync(id);
          if (currentProjectId === id) {
            const remaining = (allProjects ?? []).filter((p) => p.id !== id);
            setCurrentProjectId(remaining[0]?.id ?? null);
          }
          toast('Đã xóa dự án.');
        }}
      />
    </section>
  );
}
