import { create } from 'zustand';
import type { Entity } from '@shared/types';
import { builderStore, type SavedViewPayload } from '@/store/builder';
import { useCustomSql } from '@/store/customSql';
import { ENTITY } from './entities';
import { encodeHash } from './tree';
import type { SavedSql } from './savedQueries';

/** Which saved query each builder page was loaded from (so "Update" knows what to overwrite). */
export const useLoadedSaved = create<{ ids: Record<Entity, string | null>; set: (e: Entity, id: string | null) => void }>((set) => ({
  ids: { assets: null, vulnerabilities: null },
  set: (e, id) => set((s) => ({ ids: { ...s.ids, [e]: id } })),
}));

/** Loads a builder query into its page's store (no navigation). */
export function loadBuilderQuery(q: SavedSql) {
  const entity = q.entity as Entity;
  builderStore(entity).getState().loadView(q.payload as SavedViewPayload);
  useLoadedSaved.getState().set(entity, q.id);
}

/** Opens a saved query where it was built: SQL in Custom SQL, Assets / Vulnerabilities queries on their page with the filters applied. */
export function openSavedQuery(q: SavedSql, navigate: (to: string) => void) {
  if (q.kind === 'builder' && q.entity && q.payload) {
    loadBuilderQuery(q);
    const p = q.payload;
    navigate(ENTITY[q.entity].path + encodeHash(p.tree, p.options, p.mode === 'summary' ? p.summary : null));
  } else {
    useCustomSql.getState().setSql(q.sql);
    navigate(`/dashboard/sql?q=${q.id}`);
  }
}
