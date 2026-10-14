import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import type { FieldDef, SummarySpec } from '@shared/types';
import { Button, ErrorPanel, Segmented, Skeleton } from '@/components/ui/primitives';
import { Api, type RunResponse, type SummaryRequest } from '@/lib/api';
import { exportCsv } from '@/lib/export';
import { fmtNum, fmtSecs } from '@/lib/utils';
import { colorFor, axisTick, tooltipStyle } from '@/pages/overview/widgets';

const fmtCell = (v: unknown) => (typeof v === 'number' ? fmtNum(v, 2) : v === null || v === undefined ? '–' : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? String(v).slice(0, 10) : String(v));

function Chart({ data, spec }: { data: RunResponse; spec: SummarySpec }) {
  const two = spec.groupBy.length === 2;
  const { rows, series } = useMemo(() => {
    if (!two) return { rows: data.rows.map((r) => ({ name: String(r.group_1), value: Number(r.metric_1 ?? 0) })), series: ['value'] };
    const by = new Map<string, Record<string, any>>();
    const totals = new Map<string, number>();
    for (const r of data.rows) {
      const k = String(r.group_1), s = String(r.group_2), v = Number(r.metric_1 ?? 0);
      by.set(k, { ...(by.get(k) ?? { name: k }), [s]: v });
      totals.set(s, (totals.get(s) ?? 0) + v);
    }
    return { rows: [...by.values()], series: [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s) };
  }, [data, two]);
  const metricName = data.labels?.[spec.groupBy.length] ?? 'Value';
  if (!rows.length) return <p className="py-8 text-center text-xs text-muted-foreground">No data</p>;
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{metricName}{two ? ` · stacked by ${data.labels?.[1]}` : ''}</div>
      <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 30 + 40)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals />
          <YAxis type="category" dataKey="name" width={130} tick={axisTick} axisLine={false} tickLine={false} interval={0} />
          <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [fmtNum(Number(v), 2), two ? n : metricName]} />
          {two && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => (
            <Bar key={s} dataKey={s} name={s} stackId={two ? 'a' : undefined} fill={colorFor(s, i)} radius={two ? 0 : [0, 3, 3, 0]} isAnimationActive={false}>
              {!two && rows.map((_, j) => <Cell key={j} fill="hsl(var(--primary))" />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Runs a summary request and shows it as a table or a chart, with CSV and optional drill-down. */
export function SummaryResult({ req, spec, onSort, onDrill, exportCap = 1_000_000, fieldMap }: {
  req: SummaryRequest | null;
  spec: SummarySpec;
  onSort?: (by: string) => void;
  onDrill?: (row: Record<string, any>) => void;
  exportCap?: number;
  fieldMap?: Map<string, FieldDef>;
}) {
  const [view, setView] = useState<'table' | 'chart'>('table');
  const q = useQuery({ queryKey: ['summary', req], queryFn: ({ signal }) => Api.summaryRun(req!, signal), enabled: !!req, placeholderData: keepPreviousData, staleTime: 5 * 60_000, retry: 0 });
  void fieldMap;
  if (!req) return <p className="py-8 text-center text-sm text-muted-foreground">Set up the summary above and press Run.</p>;
  if (q.isPending) return <div className="space-y-2"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-40 w-full" /></div>;
  if (q.isError && !q.data) return <ErrorPanel message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const data = q.data!;
  const labels = data.labels ?? data.columns;
  const sortBy = req.summary.sort?.by ?? 'metric_1';
  const sortDir = req.summary.sort?.dir ?? (sortBy.startsWith('metric') ? 'desc' : 'asc');
  const shown = data.rows.length;

  return (
    <div className={q.isFetching ? 'opacity-70 transition-opacity' : ''}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm" aria-live="polite">
          {shown < data.total ? <>Top <b className="num">{fmtNum(shown)}</b> of <b className="num">{fmtNum(data.total)}</b> groups</> : <><b className="num">{fmtNum(data.total)}</b> group{data.total === 1 ? '' : 's'}</>}
          <span className="text-muted-foreground"> · query ran in {fmtSecs(data.elapsedMs)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Segmented size="sm" ariaLabel="View" value={view} onChange={setView} options={[{ value: 'table', label: 'Table' }, { value: 'chart', label: 'Chart' }]} />
          <Button size="sm" onClick={() => void exportCsv(req, data.total, exportCap)} disabled={!data.total} title="Exports every group, not just the top ones"><Download size={13} /> CSV</Button>
        </div>
      </div>

      {view === 'chart' ? (
        <Chart data={data} spec={spec} />
      ) : data.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No rows match these filters.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr>
                {data.columns.map((c, i) => (
                  <th key={c} className={`px-3 py-2 text-xs font-semibold text-muted-foreground ${c.startsWith('metric') ? 'text-right' : 'text-left'}`} aria-sort={sortBy === c ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort?.(c)} disabled={!onSort}>
                      {labels[i]} {sortBy === c && (sortDir === 'asc' ? <ArrowUp size={11} className="text-primary" /> : <ArrowDown size={11} className="text-primary" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} tabIndex={onDrill ? 0 : undefined} onClick={() => onDrill?.(r)} onKeyDown={(e) => e.key === 'Enter' && onDrill?.(r)} className={`border-t border-border/60 ${onDrill ? 'cursor-pointer hover:bg-muted/50' : ''}`} title={onDrill ? 'Click to see these rows' : undefined}>
                  {data.columns.map((c) => <td key={c} className={`px-3 py-1.5 ${c.startsWith('metric') ? 'num text-right' : ''}`}>{fmtCell(r[c])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {onDrill && view === 'table' && data.rows.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Click a row to see the underlying records.</p>}
    </div>
  );
}
