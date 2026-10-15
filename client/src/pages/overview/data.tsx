import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { Api } from '@/lib/api';
import type { GlobalFilters } from '@shared/types';
import { useFilters } from '@/store/filters';
import { useExecCross } from '@/store/execCross';
import { L } from '@shared/semantics';

export type Row = Record<string, any>;
/** One request per row of the page so each row streams in as soon as its queries finish. */
export const BATCHES: Record<string, string[]> = {
  kpis: ['kpiTotalAssets', 'kpiOpenVulns', 'kpiCritHigh', 'kpiKev', 'kpiSla', 'kpiExposedCritHigh'],
  dist: ['severityDonut', 'slaStatus', 'overdueBuckets', 'ageBuckets'],
  tops: ['topAssets', 'topVulns', 'topSoftware'],
  execAssets: ['execTotals', 'execByClass', 'execServersByOs'],
  execBands: ['execServerBands', 'execServerKpis'],
  execApps: ['execAppsByCount', 'execAppsByScore'],
  execServers: ['execTopServers'],
  breakdown: ['assetsByBusinessUnit', 'findingsByBusinessUnit', 'assetsByRegion', 'findingsByRegion'],
  inventory: ['riskByBusinessUnit', 'assetsByCriticality', 'assetsByClass', 'coverage', 'toolVisibility', 'eolAssets'],
};

export interface WState {
  loading: boolean;
  fetching: boolean;
  error?: string;
  /** the data has no column this widget needs (not an error) */
  unavailable?: string;
  rows?: Row[];
  elapsedMs?: number;
  /** fixed filters this card could not apply (the column does not exist in its table) */
  ignoredFilters?: string[];
  refetch: () => void;
}
const Ctx = createContext<Record<string, WState>>({});
export const useWidget = (id: string): WState => useContext(Ctx)[id] ?? { loading: true, fetching: true, refetch: () => undefined };

/** Section 4 only: the application picked in Section 3 becomes one more (finding-level) filter. */
const withSoftware = (f: GlobalFilters, software: string): GlobalFilters => ({ ...f, extra: [...(f.extra ?? []), { id: 'cross:software', entity: 'vulnerabilities', condition: { type: 'condition', field: L('software_name'), operator: 'is', value: software, not: false } }] });

export function OverviewDataProvider({ children }: { children: ReactNode }) {
  const filters = useFilters((s) => s.filters);
  const options = useFilters((s) => s.options);
  const software = useExecCross((s) => s.software);
  const names = Object.keys(BATCHES);
  const results = useQueries({
    queries: names.map((name) => ({
      queryKey: ['widgets', name, filters, options, name === 'execServers' ? software : null],
      queryFn: ({ signal }: { signal: AbortSignal }) => Api.widgets(BATCHES[name], name === 'execServers' && software ? withSoftware(filters, software) : filters, options, signal),
      placeholderData: keepPreviousData,
      staleTime: 5 * 60_000,
      retry: 0,
    })),
  });

  const value = useMemo(() => {
    const out: Record<string, WState> = {};
    names.forEach((name, i) => {
      const r = results[i];
      for (const id of BATCHES[name]) {
        const w = r.data?.[id];
        out[id] = {
          loading: r.isPending,
          fetching: r.isFetching,
          error: r.isError && !r.data ? (r.error as Error).message : w && 'error' in w ? w.error : undefined,
          unavailable: w && 'unavailable' in w ? w.unavailable : undefined,
          rows: w && 'rows' in w ? (w.rows as Row[]) : undefined,
          elapsedMs: w && 'rows' in w ? w.elapsedMs : undefined,
          ignoredFilters: w && 'rows' in w ? w.ignoredFilters : undefined,
          refetch: () => void r.refetch(),
        };
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, results.map((r) => r.dataUpdatedAt + ':' + r.status + ':' + r.fetchStatus));

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
