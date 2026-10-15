import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Entity } from '@shared/types';
import type { SavedViewPayload } from './builder';
import { uid } from '@/lib/utils';

export interface SavedView extends SavedViewPayload {
  id: string;
  name: string;
  entity: Entity;
  createdAt: number;
}
interface SavedState {
  views: SavedView[];
  save: (entity: Entity, name: string, payload: SavedViewPayload) => SavedView;
  remove: (id: string) => void;
  importViews: (json: string) => number;
  exportViews: () => string;
}
export const useSaved = create<SavedState>()(
  persist(
    (set, get) => ({
      views: [],
      save: (entity, name, payload) => {
        const view: SavedView = { id: uid(), name, entity, createdAt: Date.now(), ...payload };
        set((s) => ({ views: [...s.views.filter((v) => !(v.entity === entity && v.name === name)), view] }));
        return view;
      },
      remove: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
      exportViews: () => JSON.stringify({ app: 'vip', version: 1, views: get().views }, null, 2),
      importViews: (json) => {
        const parsed = JSON.parse(json);
        const incoming: SavedView[] = (Array.isArray(parsed) ? parsed : parsed.views ?? []).filter(
          (v: any) => v && (v.entity === 'assets' || v.entity === 'vulnerabilities') && typeof v.name === 'string' && v.tree?.type === 'group',
        );
        set((s) => {
          const map = new Map(s.views.map((v) => [`${v.entity}:${v.name}`, v]));
          for (const v of incoming) map.set(`${v.entity}:${v.name}`, { ...v, id: uid(), createdAt: v.createdAt ?? Date.now(), columns: v.columns ?? null, sort: v.sort ?? null, options: v.options ?? { latestSnapshotOnly: true } });
          return { views: [...map.values()] };
        });
        return incoming.length;
      },
    }),
    { name: 'vip-saved-views' },
  ),
);
