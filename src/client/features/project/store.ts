import { create } from 'zustand';

const STORAGE_KEY = 'videoTool.currentProjectId.v1';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors (private browsing, storage disabled, ...)
  }
}

type ProjectUiState = {
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
};

/** UI-only state: which project is "open". Persisted in localStorage, not server state. */
export const useProjectUiStore = create<ProjectUiState>((set) => ({
  currentProjectId: readStored(),
  setCurrentProjectId: (id) => {
    writeStored(id);
    set({ currentProjectId: id });
  },
}));
