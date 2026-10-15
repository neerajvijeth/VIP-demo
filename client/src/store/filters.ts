import { create } from 'zustand';
import type { GlobalFilters, QueryOptions } from '@shared/types';
import { EMPTY_FILTERS } from '@shared/types';

interface FilterState {
  filters: GlobalFilters;
  options: QueryOptions;
  setFilters: (f: GlobalFilters) => void;
  patch: (p: Partial<GlobalFilters>) => void;
  clear: () => void;
  setOptions: (o: Partial<QueryOptions>) => void;
}
export const useFilters = create<FilterState>((set) => ({
  filters: EMPTY_FILTERS,
  options: { latestSnapshotOnly: true },
  setFilters: (filters) => set({ filters }),
  patch: (p) => set((s) => ({ filters: { ...s.filters, ...p } })),
  clear: () => set({ filters: EMPTY_FILTERS }),
  setOptions: (o) => set((s) => ({ options: { ...s.options, ...o } })),
}));

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const LISTS: Record<string, 'priority' | 'os_family'> = { pr: 'priority', osf: 'os_family' };
const PARAMS: Record<string, keyof GlobalFilters> = { bu: 'business_unit', region: 'region', country: 'country', crit: 'criticality', class: 'asset_class', dtype: 'device_type' };

export function filtersToSearch(f: GlobalFilters, o: QueryOptions): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [p, k] of Object.entries(PARAMS)) for (const v of f[k] as string[]) sp.append(p, v);
  if (f.internet_exposed !== 'all') sp.set('exp', f.internet_exposed);
  for (const [p, k] of Object.entries(LISTS)) for (const v of f[k] ?? []) sp.append(p, v);
  if (f.kev && f.kev !== 'all') sp.set('kev', f.kev);
  if (!o.latestSnapshotOnly) sp.set('latest', '0');
  if (f.extra?.length) sp.set('x', b64(JSON.stringify(f.extra.map(({ entity, condition }) => ({ entity, condition: { field: condition.field, operator: condition.operator, value: condition.value } })))));
  return sp;
}
export function searchToFilters(sp: URLSearchParams): { filters: GlobalFilters; options: QueryOptions } {
  const filters: GlobalFilters = { ...EMPTY_FILTERS };
  for (const [p, k] of Object.entries(PARAMS)) (filters[k] as string[]) = sp.getAll(p);
  const exp = sp.get('exp');
  filters.internet_exposed = exp === 'yes' || exp === 'no' ? exp : 'all';
  for (const [p, k] of Object.entries(LISTS)) filters[k] = sp.getAll(p);
  const kev = sp.get('kev');
  filters.kev = kev === 'yes' || kev === 'no' ? kev : 'all';
  const x = sp.get('x');
  if (x) {
    try {
      const arr = JSON.parse(unb64(x));
      filters.extra = Array.isArray(arr) ? arr.filter((e: any) => (e?.entity === 'assets' || e?.entity === 'vulnerabilities') && typeof e?.condition?.field === 'string').slice(0, 20).map((e: any) => ({ id: Math.random().toString(36).slice(2, 10), entity: e.entity, condition: { type: 'condition' as const, field: e.condition.field, operator: String(e.condition.operator), value: e.condition.value ?? null, not: false } })) : [];
    } catch { filters.extra = []; }
  }
  return { filters, options: { latestSnapshotOnly: sp.get('latest') !== '0' } };
}
