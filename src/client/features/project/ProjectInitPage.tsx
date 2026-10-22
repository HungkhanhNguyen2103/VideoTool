import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import type { ProjectImportSeed } from '../../../contracts/project';
import { YoutubeIdeaProjectPrefillSchema } from '../../../contracts/youtube-ideas';
import { markYoutubeIdeaUsed } from '../youtube/api';
import { NewProjectForm } from './components/NewProjectForm';
import { RecentProjects } from './components/RecentProjects';
import styles from './ProjectInitPage.module.css';

const YoutubeIdeaRouteStateSchema = z.object({
  youtubeIdea: z.object({ ideaId: z.string().min(1), prefill: YoutubeIdeaProjectPrefillSchema }).strict(),
}).strict();
type ProjectInitPrefill = ProjectImportSeed & { channelId?: string | null; researchNote?: string };

export function ProjectInitPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [prefill, setPrefill] = useState<ProjectInitPrefill | null>(null);
  const [ideaHandoff, setIdeaHandoff] = useState<{ ideaId: string; channelId: string } | null>(null);

  useEffect(() => {
    const parsed = YoutubeIdeaRouteStateSchema.safeParse(location.state);
    if (!parsed.success) return;
    const { ideaId, prefill: ideaPrefill } = parsed.data.youtubeIdea;
    setPrefill({ ...ideaPrefill, channelId: ideaPrefill.channelId, researchNote: ideaPrefill.researchNote });
    setIdeaHandoff({ ideaId, channelId: ideaPrefill.channelId });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.key, location.pathname, location.state, navigate]);

  async function markIdeaUsed(projectId: string) {
    if (!ideaHandoff) return;
    await markYoutubeIdeaUsed(ideaHandoff.channelId, ideaHandoff.ideaId, projectId);
    setIdeaHandoff(null);
  }

  return (
    <div className={styles.grid}>
      <NewProjectForm prefill={prefill} onPrefillApplied={() => setPrefill(null)} onProjectCreated={markIdeaUsed} />
      <RecentProjects onImportSeed={(seed) => setPrefill(seed)} />
    </div>
  );
}
