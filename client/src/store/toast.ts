import { create } from 'zustand';
import { uid } from '@/lib/utils';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  kind: 'info' | 'success' | 'error' | 'warning' | 'progress';
  progress?: number; // 0..1
}
interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ttl?: number) => string;
  update: (id: string, patch: Partial<Toast>, ttl?: number) => void;
  dismiss: (id: string) => void;
}
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ttl = 5000) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    if (t.kind !== 'progress' && ttl > 0) setTimeout(() => get().dismiss(id), ttl);
    return id;
  },
  update: (id, patch, ttl) => {
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    if (ttl) setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
export const toast = {
  info: (title: string, description?: string) => useToasts.getState().push({ kind: 'info', title, description }),
  success: (title: string, description?: string) => useToasts.getState().push({ kind: 'success', title, description }),
  error: (title: string, description?: string) => useToasts.getState().push({ kind: 'error', title, description }, 9000),
  warning: (title: string, description?: string) => useToasts.getState().push({ kind: 'warning', title, description }, 9000),
};
