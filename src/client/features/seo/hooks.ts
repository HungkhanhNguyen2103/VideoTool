import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SeoPackage, SeoPatch } from '../../../contracts/seo';
import * as api from './api';
import type { SaveState } from './seo-view';

export function useSeoProject(projectId: string) {
  const project = useQuery({ queryKey: ['projects', 'detail', projectId], queryFn: () => api.getSeoProject(projectId), enabled: Boolean(projectId) });
  const files = useQuery({ queryKey: ['project-files', projectId], queryFn: () => api.listSeoFiles(projectId), enabled: Boolean(projectId) });
  return { project, files };
}

function mergeSeo(previous: SeoPackage, patch: SeoPatch): SeoPackage {
  return {
    ...previous,
    ...patch,
    thumbnail: patch.thumbnail ? { ...previous.thumbnail, ...patch.thumbnail } : previous.thumbnail,
  } as SeoPackage;
}

export function useSeoDraft(projectId: string, initialSeo: SeoPackage | undefined) {
  const [draft, setDraft] = useState<SeoPackage | undefined>(initialSeo);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pendingRef = useRef<SeoPatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<SeoPackage | undefined>(initialSeo);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (Object.keys(pendingRef.current).length === 0) {
      draftRef.current = initialSeo;
      setDraft(initialSeo);
      setSaveState('idle');
    }
  }, [initialSeo, projectId]);

  const flush = async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const patch = pendingRef.current;
    if (Object.keys(patch).length === 0) return;
    pendingRef.current = {};
    setSaveState('saving');
    try {
      const saved = await api.patchSeo(projectId, patch);
      if (Object.keys(pendingRef.current).length === 0) {
        draftRef.current = saved.seo;
        setDraft(saved.seo);
      }
      setSaveState('saved');
    } catch {
      pendingRef.current = { ...patch, ...pendingRef.current };
      setSaveState('error');
    }
  };
  flushRef.current = flush;

  useEffect(() => () => { void flushRef.current(); }, [projectId]);

  function update(patch: SeoPatch): void {
    const next = mergeSeo(draftRef.current ?? initialSeo!, patch);
    draftRef.current = next;
    setDraft(next);
    pendingRef.current = { ...pendingRef.current, ...patch };
    setSaveState('idle');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flushRef.current(); }, 600);
  }

  return { draft, saveState, update, flush };
}
