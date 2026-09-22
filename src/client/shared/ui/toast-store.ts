import { create } from 'zustand';

type ToastState = { message: string | null; show: (message: string) => void };

let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** Global toast: one message at a time, auto-hides after 3s (matches the prototype). */
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    clearTimeout(hideTimer);
    set({ message });
    hideTimer = setTimeout(() => set({ message: null }), 3000);
  },
}));

export const toast = (message: string) => useToastStore.getState().show(message);
