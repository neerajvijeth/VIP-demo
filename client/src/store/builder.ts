import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Entity, FieldDef, Group, QueryOptions, RunRequest, SortSpec, SummarySpec } from '@shared/types';
import { emptySummary } from '@shared/types';
import { L } from '@shared/semantics';
import type { SummaryRequest } from '@/lib/api';
import { addChild, cleanTree, duplicateNode, freshTree, moveNode, newCondition, newGroup, removeNode, setGroupOp, unwrapGroup, updateNode, withIds, wrapNode } from '@/lib/tree';
import { ENTITY } from '@/lib/entities';
import type { Node } from '@shared/types';

export interface SavedViewPayload {
  mode?: 'rows' | 'summary';
  summary?: SummarySpec;
  tree: Group;
  columns: string[] | null;
  sort: SortSpec | null;
  options: QueryOptions;
}

export interface BuilderState {
  entity: Entity;
  tree: Group;
  columns: string[] | null; // null → catalog defaults
  sort: SortSpec | null;
  pageSize: number;
  page: number;
  options: QueryOptions;
  /** Last executed request; drives the results query so results survive navigation. */
  ran: RunRequest | null;
  mode: 'rows' | 'summary';
  summary: SummarySpec;
  ranSummary: SummaryRequest | null;
  pendingRun: boolean;
  builderOpen: boolean;
  density: 'compact' | 'comfortable';
  detail: { key: string; snapshot?: string } | null;
  meta: { fields: Map<string, FieldDef>; defaults: string[]; columnKeys: Set<string> } | null;

  setMeta: (fields: FieldDef[], defaults: string[], columnKeys?: string[]) => void;
  setTree: (t: Group) => void;
  addCondition: (groupId: string, field?: FieldDef) => void;
  addGroup: (groupId: string) => void;
  patchNode: (id: string, patch: Partial<Node>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  wrap: (id: string) => void;
  setOp: (id: string, op: 'AND' | 'OR') => void;
  ungroup: (id: string) => void;
  move: (id: string, groupId: string, index?: number) => void;
  clearTree: () => void;
  setOptions: (o: Partial<QueryOptions>) => void;
  setColumns: (cols: string[] | null) => void;
  setSort: (s: SortSpec | null) => void;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  setBuilderOpen: (b: boolean) => void;
  setDensity: (d: 'compact' | 'comfortable') => void;
  setDetail: (d: BuilderState['detail']) => void;
  run: () => void;
  setMode: (m: 'rows' | 'summary') => void;
  setSummary: (s: SummarySpec) => void;
  /** Replace the query (presets, click-through, saved views) and optionally execute it. */
  openWith: (tree: Group, options?: Partial<QueryOptions>, run?: boolean, summary?: SummarySpec | null) => void;
  loadView: (v: SavedViewPayload) => void;
  snapshotView: () => SavedViewPayload;
}

export const effectiveColumns = (s: Pick<BuilderState, 'columns' | 'meta'>) => s.columns ?? s.meta?.defaults ?? [];

/** Hidden columns the table always needs for the detail drawer. */
const withKeys = (entity: Entity, cols: string[], available?: Set<string>) => {
  const out = [...cols];
  for (const k of [ENTITY[entity].key, L('snapshot_date')]) if (!out.includes(k) && (!available || available.has(k))) out.push(k);
  return out;
};

function make(entity: Entity): UseBoundStore<StoreApi<BuilderState>> {
  return create<BuilderState>((set, get) => {
    const patchRan = (patch: Partial<RunRequest>) => {
      const ran = get().ran;
      return ran ? { ran: { ...ran, ...patch } } : {};
    };
    const execute = (): Partial<BuilderState> => {
      const s = get();
      if (!s.meta) return { pendingRun: true };
      if (s.mode === 'summary') {
        return { pendingRun: false, ranSummary: { mode: 'summary', entity, tree: cleanTree(s.tree, s.meta.fields), options: s.options, summary: s.summary } };
      }
      return {
        pendingRun: false,
        page: 0,
        ran: {
          entity,
          tree: cleanTree(s.tree, s.meta.fields),
          columns: withKeys(entity, effectiveColumns(s), s.meta.columnKeys),
          sort: s.sort,
          page: 0,
          pageSize: s.pageSize,
          options: s.options,
        },
      };
    };
    return {
      entity,
      tree: freshTree(),
      columns: null,
      sort: null,
      pageSize: 50,
      page: 0,
      options: { latestSnapshotOnly: true, validOnly: true },
      ran: null,
      mode: 'rows',
      summary: emptySummary(entity),
      ranSummary: null,
      pendingRun: false,
      builderOpen: true,
      density: 'comfortable',
      detail: null,
      meta: null,

      setMeta: (fields, defaults, columnKeys) => set({ meta: { fields: new Map(fields.map((f) => [f.key, f])), defaults, columnKeys: new Set(columnKeys ?? fields.map((f) => f.key)) } }),
      setTree: (tree) => set({ tree }),
      addCondition: (groupId, field) => set((s) => ({ tree: addChild(s.tree, groupId, newCondition(field)) })),
      addGroup: (groupId) => set((s) => ({ tree: addChild(s.tree, groupId, newGroup()) })),
      patchNode: (id, patch) => set((s) => ({ tree: updateNode(s.tree, id, patch as any) })),
      remove: (id) => set((s) => ({ tree: removeNode(s.tree, id) })),
      duplicate: (id) => set((s) => ({ tree: duplicateNode(s.tree, id) })),
      wrap: (id) => set((s) => ({ tree: wrapNode(s.tree, id) })),
      setOp: (id, op) => set((s) => ({ tree: setGroupOp(s.tree, id, op) })),
      ungroup: (id) => set((s) => ({ tree: unwrapGroup(s.tree, id) })),
      move: (id, groupId, index) => set((s) => ({ tree: moveNode(s.tree, id, groupId, index) })),
      clearTree: () => set({ tree: freshTree() }),
      setOptions: (o) => set((s) => ({ options: { ...s.options, ...o } })),
      setColumns: (columns) => {
        set({ columns });
        const s = get();
        if (s.ran) set({ ran: { ...s.ran, columns: withKeys(entity, columns ?? s.meta?.defaults ?? [], s.meta?.columnKeys) } });
      },
      setSort: (sort) => set({ sort, page: 0, ...patchRan({ sort, page: 0 }) }),
      setPage: (page) => set({ page, ...patchRan({ page }) }),
      setPageSize: (pageSize) => set({ pageSize, page: 0, ...patchRan({ pageSize, page: 0 }) }),
      setBuilderOpen: (builderOpen) => set({ builderOpen }),
      setDensity: (density) => set({ density }),
      setDetail: (detail) => set({ detail }),
      run: () => set(execute()),
      setMode: (mode) => set({ mode }),
      setSummary: (summary) => set({ summary }),
      openWith: (tree, options, run = true, summary) => {
        set((s) => ({ tree: withIds(tree), options: { ...s.options, ...options }, sort: null, page: 0, detail: null, mode: summary ? 'summary' : 'rows', summary: summary ?? s.summary }));
        if (run) set(execute());
      },
      loadView: (v) => {
        set((s) => ({ tree: withIds(v.tree), columns: v.columns, sort: v.sort, options: v.options, page: 0, mode: v.mode ?? 'rows', summary: v.summary ?? s.summary }));
        set(execute());
      },
      snapshotView: () => {
        const s = get();
        return { tree: s.meta ? cleanTree(s.tree, s.meta.fields) : s.tree, columns: s.columns, sort: s.sort, options: s.options, mode: s.mode, summary: s.summary };
      },
    };
  });
}

export const useAssetsBuilder = make('assets');
export const useVulnBuilder = make('vulnerabilities');
export const builderStore = (e: Entity) => (e === 'assets' ? useAssetsBuilder : useVulnBuilder);
