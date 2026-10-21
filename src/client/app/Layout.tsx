import { Link, matchPath, Outlet, useLocation } from 'react-router-dom';
import { useProject } from '../features/project/hooks';
import { useProjectUiStore } from '../features/project/store';
import { projectDetailMeta } from '../features/project/format';
import { Icon } from '../shared/ui/Icon';
import styles from './Layout.module.css';

const PRODUCTION_TABS = [
  { key: 'init', label: '1. Khởi Tạo Dự Án', icon: 'sparkles', path: () => '/production/init', needsProject: false },
  { key: 'review', label: '2. Duyệt & Tái Tạo', icon: 'doc', path: (id: string) => `/production/${id}/review`, needsProject: true },
  {
    key: 'studio',
    label: '3. Studio Phân Cảnh & Xuất Video',
    icon: 'video',
    path: (id: string) => `/production/${id}/studio`,
    needsProject: true,
  },
  { key: 'seo', label: '4. SEO & Đóng Gói Kênh', icon: 'tag', path: (id: string) => `/production/${id}/seo`, needsProject: true },
] as const;

export function Layout() {
  const location = useLocation();
  const currentProjectId = useProjectUiStore((s) => s.currentProjectId);
  const { data: currentProject } = useProject(currentProjectId);

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandLogo}>
            <Icon name="film" size="lg" />
          </span>
          <span className={styles.brandName}>Video Tool</span>
        </div>
        <nav className={styles.menu} aria-label="Menu tổng">
          <div className={`label ${styles.menuLabel}`}>Menu</div>
          <Link to="/production/init" className={`${styles.menuItem} ${styles.menuItemActive}`} aria-current="page">
            <Icon name="film" size="lg" />
            <span>Sản Xuất &amp; Kịch Bản</span>
          </Link>
          <button className={styles.menuItem} type="button" disabled aria-disabled="true">
            <Icon name="lock" size="lg" />
            <span className={styles.menuText}>Menu 2</span>
            <span className={styles.pill}>Sắp có</span>
          </button>
          <button className={styles.menuItem} type="button" disabled aria-disabled="true">
            <Icon name="lock" size="lg" />
            <span className={styles.menuText}>Menu 3</span>
            <span className={styles.pill}>Sắp có</span>
          </button>
        </nav>
      </aside>

      <main className={styles.main}>
        <header className={styles.projectHead}>
          <div>
            <div className="label">Dự án đang mở</div>
            <h1>{currentProject ? currentProject.title : 'Chưa mở dự án nào'}</h1>
          </div>
          <div className={styles.projectHeadActions}>
            {currentProject?.channelId && <Link className={styles.analyticsLink} to={`/channels/${encodeURIComponent(currentProject.channelId)}/analytics`}>Phân tích kênh</Link>}
            <div className={`${styles.chip} ${styles.chipMeta}`}>
              <Icon name="pin" />
              <span>{currentProject ? projectDetailMeta(currentProject) : '—'}</span>
            </div>
          </div>
        </header>

        <nav className={styles.tabs} aria-label="Các bước sản xuất">
          {PRODUCTION_TABS.map((tab) => {
            const pattern = tab.key === 'init' ? '/production/init' : `/production/:projectId/${tab.key}`;
            const isActive = matchPath(pattern, location.pathname) !== null;
            const disabled = tab.needsProject && !currentProjectId;
            const cls = `${styles.tab} ${isActive ? styles.tabActive : ''}`;
            if (disabled) {
              return (
                <button key={tab.key} type="button" className={cls} disabled aria-disabled="true" title="Mở một dự án trước.">
                  <Icon name={tab.icon} />
                  <span>{tab.label}</span>
                </button>
              );
            }
            return (
              <Link key={tab.key} to={tab.path(currentProjectId ?? '')} className={cls} aria-current={isActive ? 'page' : undefined}>
                <Icon name={tab.icon} />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>

        <Outlet />
      </main>
    </div>
  );
}
