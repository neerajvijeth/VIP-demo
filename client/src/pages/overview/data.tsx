import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { Api } from '@/lib/api';
import { useFilters } from '@/store/filters';

export type Row = Record<string, any>;
/** One request per row of the page so each row streams in as soon as its queries finish. */
export const BATCHES: Record<string, string[]> = {
  kpis: ['kpiTotalAssets', 'kpiOpenVulns', 'kpiCritHigh', 'kpiKev', 'kpiSla', 'kpiExposedCritHigh'],
  dist: ['severityDonut', 'slaStatus', 'overdueBuckets', 'ageBuckets'],
  tops: ['topAssets', 'topVulns', 'topSoftware'],
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
  refetch: () => void;
}
const Ctx = createContext<Record<string, WState>>({});
export const useWidget = (id: string): WState => useContext(Ctx)[id] ?? { loading: true, fetching: true, refetch: () => undefined };

export function OverviewDataProvider({ children }: { children: ReactNode }) {
  const filters = useFilters((s) => s.filters);
  const options = useFilters((s) => s.options);
  const names = Object.keys(BATCHES);
  const results = useQueries({
    queries: names.map((name) => ({
      queryKey: ['widgets', name, filters, options],
      queryFn: ({ signal }: { signal: AbortSignal }) => Api.widgets(BATCHES[name], filters, options, signal),
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
          refetch: () => void r.refetch(),
        };
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, results.map((r) => r.dataUpdatedAt + ':' + r.status + ':' + r.fetchStatus));

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
