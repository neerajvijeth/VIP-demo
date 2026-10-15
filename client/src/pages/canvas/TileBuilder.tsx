import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { ChartView } from '@/components/charts/ChartView';
import { Badge } from '@/components/ui/badges';
import { Button, ErrorPanel, Input, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/overlay';
import { ApiError } from '@/lib/api';
import { CHART_TYPES, CanvasApi, type Agg, type Chart, type ChartType, type Col, type Tile } from '@/lib/canvas';
import { SavedApi, useSavedSql } from '@/lib/savedQueries';
import { useDebounced, uid } from '@/lib/utils';

const AGGS: Array<{ value: Agg; label: string; needs: 'none' | 'any' | 'num' }> = [
  { value: 'count', label: 'Count of rows', needs: 'none' }, { value: 'count_distinct', label: 'Count distinct', needs: 'any' },
  { value: 'sum', label: 'Sum', needs: 'num' }, { value: 'avg', label: 'Average', needs: 'num' }, { value: 'min', label: 'Minimum', needs: 'num' }, { value: 'max', label: 'Maximum', needs: 'num' },
];
const lab = 'mb-1 block text-[11px] font-medium text-muted-foreground';

/** Everything the chart needs is present (so we never send half-configured charts to the server). */
export function chartReady(c: Chart): string | null {
  const t = CHART_TYPES.find((x) => x.value === c.type)!;
  if (t.needs !== 'none' && !c.dimension) return 'Choose what to group by.';
  if (t.needs === 'two' && !c.split) return 'Choose the series (second column).';
  const a = AGGS.find((x) => x.value === c.measure.agg)!;
  if (a.needs !== 'none' && !c.measure.column) return `Choose the column to ${a.label.toLowerCase()}.`;
  return null;
}

export function TileBuilder({ open, onClose, initial, presetQueryId, onSave }: { open: boolean; onClose: () => void; initial?: Tile | null; presetQueryId?: string | null; onSave: (t: Tile) => void }) {
  const queries = useSavedSql();
  const [queryId, setQueryId] = useState<string | null>(null);
  const [version, setVersion] = useState<'latest' | number>('latest');
  const [search, setSearch] = useState('');
  const [chart, setChart] = useState<Chart>({ type: 'donut', measure: { agg: 'count' }, top_n: 10, other: true, sort: 'value_desc' });
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQueryId(initial?.query_id ?? presetQueryId ?? null);
    setVersion(initial?.query_version ?? 'latest');
    setChart(initial?.chart ?? { type: 'donut', measure: { agg: 'count' }, top_n: 10, other: true, sort: 'value_desc' });
    setTitle(initial?.title ?? ''); setTitleTouched(!!initial); setSearch('');
  }, [open, initial, presetQueryId]);

  const chosen = queries.data?.find((q) => q.id === queryId);
  const versions = useQuery({ queryKey: ['saved-versions', queryId], queryFn: () => SavedApi.versions(queryId!), enabled: open && !!queryId, retry: false });
  const cols = useQuery({ queryKey: ['canvas-cols', queryId, version], queryFn: () => CanvasApi.columns(queryId!, version), enabled: open && !!queryId, retry: false, staleTime: 60_000 });
  const columns: Col[] = cols.data?.columns ?? [];
  const numeric = columns.filter((c) => c.numeric);

  // sensible defaults once the columns are known (first text column as the grouping)
  useEffect(() => {
    if (!columns.length || initial) return;
    setChart((c) => (c.dimension && columns.some((x) => x.name === c.dimension) ? c : { ...c, dimension: (columns.find((x) => !x.numeric) ?? columns[0]).name }));
    if (!titleTouched && chosen) setTitle(chosen.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols.data]);

  const set = (p: Partial<Chart>) => setChart((c) => ({ ...c, ...p }));
  const needs = CHART_TYPES.find((x) => x.value === chart.type)!.needs;
  const agg = AGGS.find((a) => a.value === chart.measure.agg)!;
  const problem = !queryId ? 'Pick a saved query.' : cols.isError ? 'This saved query does not run.' : chartReady(chart);
  const draft = useDebounced(chart, 400);
  const preview = useQuery({
    queryKey: ['canvas-preview', queryId, version, draft],
    enabled: open && !!queryId && cols.isSuccess && !chartReady(draft),
    retry: false,
    queryFn: ({ signal }) => CanvasApi.tile({ query_id: queryId!, query_version: version, chart: draft }, signal),
  });
  const list = useMemo(() => (queries.data ?? []).filter((q) => !search || `${q.name} ${q.description}`.toLowerCase().includes(search.toLowerCase())), [queries.data, search]);

  const pickType = (t: ChartType) => {
    const need = CHART_TYPES.find((x) => x.value === t)!.needs;
    set({ type: t, split: need === 'two' ? chart.split ?? columns.find((c) => !c.numeric && c.name !== chart.dimension)?.name : undefined });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={initial ? 'Edit chart' : 'Add chart'} description="Pick a saved query, then choose how to draw it" width="max-w-5xl">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-4 text-xs">
          <div>
            <span className={lab}>1. Saved query</span>
            <div className="relative mb-1"><Search size={13} className="absolute left-2.5 top-2.5 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-8 pl-8" aria-label="Search saved queries" /></div>
            <ul className="max-h-44 overflow-auto rounded-md border border-border" role="listbox" aria-label="Saved queries">
              {queries.isLoading && <li className="p-2 text-muted-foreground">Loading…</li>}
              {!queries.isLoading && list.length === 0 && <li className="p-2 text-muted-foreground">{(queries.data?.length ?? 0) === 0 ? 'No saved queries yet. Save one from the Custom SQL page first.' : 'No match.'}</li>}
              {list.map((q) => (
                <li key={q.id}><button role="option" aria-selected={q.id === queryId} onClick={() => { setQueryId(q.id); setVersion('latest'); setChart((c) => ({ ...c, dimension: undefined, split: undefined, measure: { agg: 'count' } })); setTitleTouched(false); setTitle(q.name); }} className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-muted ${q.id === queryId ? 'bg-accent' : ''}`}><span className="truncate">{q.name}</span><Badge>v{q.version}</Badge></button></li>
              ))}
            </ul>
            {chosen && (
              <label className="mt-2 block"><span className={lab}>Query version</span>
                <NativeSelect className="w-full" value={String(version)} onChange={(e) => setVersion(e.target.value === 'latest' ? 'latest' : Number(e.target.value))}>
                  <option value="latest">Latest (follows edits)</option>
                  {(versions.data ?? []).map((v) => <option key={v.version} value={v.version}>Pin to v{v.version}</option>)}
                </NativeSelect>
              </label>
            )}
          </div>

          {queryId && (
            <>
              {cols.isLoading && <Skeleton className="h-24" />}
              {cols.isError && <ErrorPanel message={(cols.error as ApiError).message} detail={(cols.error as ApiError).detail} onRetry={() => void cols.refetch()} />}
              {cols.isSuccess && (
                <>
                  <label className="block"><span className={lab}>2. Chart type</span>
                    <NativeSelect className="w-full" value={chart.type} onChange={(e) => pickType(e.target.value as ChartType)}>{CHART_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</NativeSelect>
                  </label>
                  {needs !== 'none' && (
                    <label className="block"><span className={lab}>{chart.type === 'line' || chart.type === 'area' ? 'X axis (column)' : 'Group by (column)'}</span>
                      <NativeSelect className="w-full" value={chart.dimension ?? ''} onChange={(e) => set({ dimension: e.target.value || undefined })}><option value="">Choose…</option>{columns.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}</NativeSelect>
                    </label>
                  )}
                  {needs === 'two' && (
                    <label className="block"><span className={lab}>Series (second column)</span>
                      <NativeSelect className="w-full" value={chart.split ?? ''} onChange={(e) => set({ split: e.target.value || undefined })}><option value="">Choose…</option>{columns.filter((c) => c.name !== chart.dimension).map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}</NativeSelect>
                    </label>
                  )}
                  {chart.type !== 'table' && (
                    <div><span className={lab}>3. Value</span>
                      <NativeSelect className="w-full" value={chart.measure.agg} onChange={(e) => set({ measure: { agg: e.target.value as Agg } })} aria-label="Aggregation">{AGGS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</NativeSelect>
                      {agg.needs !== 'none' && (
                        <NativeSelect className="mt-1 w-full" value={chart.measure.column ?? ''} onChange={(e) => set({ measure: { agg: chart.measure.agg, column: e.target.value || undefined } })} aria-label="Value column">
                          <option value="">Choose a column…</option>{(agg.needs === 'num' ? numeric : columns).map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
                        </NativeSelect>
                      )}
                      {agg.needs === 'num' && numeric.length === 0 && <p className="mt-1 text-sev-medium">This query has no numeric columns; use Count or Count distinct.</p>}
                    </div>
                  )}
                  {(chart.type === 'bar' || chart.type === 'hbar' || chart.type === 'donut') && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block"><span className={lab}>Show top</span><Input type="number" min={1} max={200} className="h-8" placeholder="All" value={chart.top_n ?? ''} onChange={(e) => set({ top_n: e.target.value ? Math.max(1, Math.min(200, Number(e.target.value))) : null })} /></label>
                      <label className="mt-5 flex items-center gap-2"><input type="checkbox" checked={chart.other !== false} onChange={(e) => set({ other: e.target.checked })} /> Group the rest as “Other”</label>
                    </div>
                  )}
                  {chart.type !== 'kpi' && chart.type !== 'table' && chart.type !== 'line' && chart.type !== 'area' && (
                    <label className="block"><span className={lab}>Sort</span>
                      <NativeSelect className="w-full" value={chart.sort ?? 'value_desc'} onChange={(e) => set({ sort: e.target.value as Chart['sort'] })}><option value="value_desc">Value, high to low</option><option value="value_asc">Value, low to high</option><option value="label_asc">Name A–Z</option><option value="label_desc">Name Z–A</option></NativeSelect>
                    </label>
                  )}
                  <label className="block"><span className={lab}>Title</span><Input className="h-8" value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }} maxLength={120} /></label>
                </>
              )}
            </>
          )}
        </div>

        <div className="min-w-0">
          <div className="eyebrow mb-2">Preview</div>
          <div className="min-h-[300px] rounded-lg border border-border bg-card p-4">
            {!queryId ? <p className="py-16 text-center text-xs text-muted-foreground">Pick a saved query to start.</p>
              : problem && !preview.data ? <p className="py-16 text-center text-xs text-muted-foreground">{problem}</p>
              : preview.isLoading ? <Skeleton className="h-52" />
              : preview.isError ? <ErrorPanel message={(preview.error as Error).message} onRetry={() => void preview.refetch()} />
              : preview.data?.state === 'ok' ? <><div className="mb-2 text-sm font-medium">{title || 'Untitled'}</div><ChartView chart={draft} data={preview.data} />{preview.data.capped && <p className="mt-2 text-[11px] text-sev-medium">Capped at 1,000 groups/rows.</p>}<p className="num mt-2 text-[10px] text-muted-foreground">{preview.data.rows?.length} row{preview.data.rows?.length === 1 ? '' : 's'} · {preview.data.elapsedMs} ms</p></>
              : <p className="py-10 text-center text-xs text-sev-critical">{preview.data?.message}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!!problem || !queryId || preview.data?.state === 'error'} onClick={() => onSave({ id: initial?.id ?? uid(), query_id: queryId!, query_version: version, title: title.trim() || chosen?.name || 'Untitled', chart, w: initial?.w ?? (chart.type === 'kpi' ? 3 : 6), h: initial?.h ?? (chart.type === 'kpi' ? 2 : 3) })}>{initial ? 'Update chart' : 'Add to canvas'}</Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
