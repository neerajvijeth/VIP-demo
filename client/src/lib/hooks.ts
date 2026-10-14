import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Entity, FieldDef, Group, QueryOptions, SummarySpec } from '@shared/types';
import { emptyGroup } from '@shared/types';
import { Api } from './api';
import { ENTITY } from './entities';
import { encodeHash } from './tree';
import { builderStore } from '@/store/builder';

export function useFields(entity: Entity) {
  const q = useQuery({ queryKey: ['fields', entity], queryFn: () => Api.fields(entity), staleTime: Infinity, gcTime: Infinity });
  const map = useMemo(() => new Map<string, FieldDef>((q.data?.fields ?? []).map((f) => [f.key, f])), [q.data]);
  const columnMap = useMemo(() => new Map<string, FieldDef>((q.data?.columns ?? []).map((f) => [f.key, f])), [q.data]);
  const setMeta = builderStore(entity)((s) => s.setMeta);
  useEffect(() => {
    if (q.data) setMeta(q.data.fields, q.data.defaultColumns, q.data.columns.map((c) => c.key));
  }, [q.data, setMeta]);
  return { ...q, fields: q.data?.fields ?? [], columns: q.data?.columns ?? [], defaults: q.data?.defaultColumns ?? [], map, columnMap };
}

const DEFAULT_OPTIONS: QueryOptions = { latestSnapshotOnly: true, validOnly: true };

/** Total row count under the default scope; powers the sidebar badges. */
export function useTotalCount(entity: Entity) {
  return useQuery({
    queryKey: ['total', entity],
    queryFn: () => Api.count(entity, emptyGroup(), DEFAULT_OPTIONS),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Prefill a builder page with a tree and run it (preset, drill-down, saved view). */
export function useOpenBuilder() {
  const navigate = useNavigate();
  return (entity: Entity, tree: Group, options?: Partial<QueryOptions>, summary?: SummarySpec | null) => {
    builderStore(entity).getState().openWith(tree, options, true, summary);
    const st = builderStore(entity).getState();
    navigate(ENTITY[entity].path + encodeHash(st.tree, st.options, st.mode === 'summary' ? st.summary : null));
  };
}

export function useRefreshed() {
  return useQuery({ queryKey: ['refreshed'], queryFn: Api.refreshed, staleTime: 5 * 60_000, retry: false });
}
