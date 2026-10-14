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
  options: { latestSnapshotOnly: true, validOnly: true },
  setFilters: (filters) => set({ filters }),
  patch: (p) => set((s) => ({ filters: { ...s.filters, ...p } })),
  clear: () => set({ filters: EMPTY_FILTERS }),
  setOptions: (o) => set((s) => ({ options: { ...s.options, ...o } })),
}));

const PARAMS: Record<string, keyof GlobalFilters> = { bu: 'business_unit', region: 'region', country: 'country', crit: 'criticality', class: 'asset_class', dtype: 'device_type' };

export function filtersToSearch(f: GlobalFilters, o: QueryOptions): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [p, k] of Object.entries(PARAMS)) for (const v of f[k] as string[]) sp.append(p, v);
  if (f.internet_exposed !== 'all') sp.set('exp', f.internet_exposed);
  if (!o.latestSnapshotOnly) sp.set('latest', '0');
  if (!o.validOnly) sp.set('valid', '0');
  return sp;
}
export function searchToFilters(sp: URLSearchParams): { filters: GlobalFilters; options: QueryOptions } {
  const filters: GlobalFilters = { ...EMPTY_FILTERS };
  for (const [p, k] of Object.entries(PARAMS)) (filters[k] as string[]) = sp.getAll(p);
  const exp = sp.get('exp');
  filters.internet_exposed = exp === 'yes' || exp === 'no' ? exp : 'all';
  return { filters, options: { latestSnapshotOnly: sp.get('latest') !== '0', validOnly: sp.get('valid') !== '0' } };
}
