import { useQuery } from '@tanstack/react-query';
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { ChevronDown } from 'lucide-react';
import { Api } from '@/lib/api';
import { Card, ErrorPanel, Skeleton } from '@/components/ui/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import { Delta, tooltipStyle } from './widgets';
import { fmtNum, titleize } from '@/lib/utils';
import { NotAppliedBanner } from './NotApplied';

export type Series = { date: string; value: number | null; suspect?: boolean }[];
export function useKpiSeries() {
  return useQuery({ queryKey: ['kpis'], queryFn: () => Api.kpis(), staleTime: 5 * 60_000, retry: 0 });
}

const FEATURED: { name: string; label: string; goodWhen: 'up' | 'down' | 'neutral' }[] = [
  { name: 'unique_managed_assets', label: 'Managed assets', goodWhen: 'neutral' },
  { name: 'known_exploited_vulnerabilities', label: 'Known exploited vulnerabilities', goodWhen: 'down' },
  { name: 'critical_risk_findings', label: 'Critical-risk findings', goodWhen: 'down' },
  { name: 'findings_past_sla', label: 'Findings past SLA', goodWhen: 'down' },
  { name: 'internet_exposed_assets', label: 'Internet-exposed assets', goodWhen: 'down' },
  { name: 'assets_impacted_by_kev', label: 'Assets impacted by KEV', goodWhen: 'down' },
  { name: 'average_vulnerability_age', label: 'Avg. vulnerability age (days)', goodWhen: 'down' },
  { name: 'average_risk_score', label: 'Average risk score', goodWhen: 'down' },
];

/** Latest two usable points: suspect runs (a >50% jump in one day) never become "today" or "previous". */
const last = (s?: Series) => s?.filter((p) => p.value !== null && !p.suspect).slice(-2) ?? [];

function TrendCard({ label, series, goodWhen, compact }: { label: string; series: Series; goodWhen: 'up' | 'down' | 'neutral'; compact?: boolean }) {
  const [prev, cur] = last(series);
  const data = series.map((p) => ({ date: p.date, v: p.suspect ? null : p.value, s: p.suspect ? p.value : null }));
  return (
    <Card className={compact ? 'p-3' : 'p-4'}>
      <div className="truncate text-xs font-medium text-muted-foreground" title={label}>{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display num text-[32px] leading-none">{cur ? fmtNum(cur.value, Math.abs(cur.value!) < 100 ? 1 : 0) : '–'}</span>
        {cur && prev && <Delta now={cur.value!} prev={prev.value} goodWhen={goodWhen} />}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">vs previous snapshot{cur ? ` · ${cur.date}` : ''}</div>
      <div className="mt-2 h-14">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtNum(Number(v), 1), label]} labelFormatter={(_l, p: any) => p?.[0]?.payload?.date ?? ''} />
            <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="s" stroke="none" dot={{ r: 3.5, stroke: 'hsl(var(--sev-medium))', strokeWidth: 1.5, fill: 'hsl(var(--card))' }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function TrendsRow() {
  const q = useKpiSeries();
  const metrics = q.data?.metrics ?? {};
  const rest = Object.keys(metrics).filter((n) => !FEATURED.some((f) => f.name === n)).sort();
  return (
    <section aria-labelledby="trends-h">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="trends-h" className="font-display text-[26px] leading-none">Trends <span className="ml-2 font-sans text-xs text-muted-foreground">from gold_kpi_metrics · global filters do not apply</span></h2>
        {rest.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="no-print inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">More metrics ({rest.length}) <ChevronDown size={12} /></button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(92vw,28rem)] p-2">
              <ul className="max-h-96 divide-y divide-border overflow-auto">
                {rest.map((n) => {
                  const [prev, cur] = last(metrics[n]);
                  return (
                    <li key={n} className="flex items-center gap-3 px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs" title={n}>{titleize(n)}</span>
                      <span className="num w-16 text-right text-sm font-medium">{cur ? fmtNum(cur.value, 1) : '–'}</span>
                      <span className="w-14">{cur && prev && <Delta now={cur.value!} prev={prev.value} goodWhen="neutral" />}</span>
                      <span className="h-6 w-16">
                        <ResponsiveContainer width="100%" height="100%"><LineChart data={metrics[n].map((p) => ({ v: p.value }))}><Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <NotAppliedBanner reason="Trends come from the KPI metrics table (gold_kpi_metrics), which only holds daily totals for the whole estate. It has no business unit, region, asset or finding columns, so nothing can be filtered here." />
      {(q.data?.suspectDates?.length || q.data?.skippedRuns) ? (
        <p className="mb-2 text-xs text-sev-medium">
          {q.data!.suspectDates?.length ? `Suspect runs on ${q.data!.suspectDates.join(', ')} (headline counts moved more than 50% in a day) are shown as hollow points and not used for the change figures. ` : ''}
          {q.data!.skippedRuns ? `${q.data!.skippedRuns} partial run${q.data!.skippedRuns === 1 ? ' was' : 's were'} skipped in favour of a complete one.` : ''}
        </p>
      ) : null}
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : q.isError ? (
        <ErrorPanel message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED.filter((f) => metrics[f.name]).map((f) => <TrendCard key={f.name} label={f.label} series={metrics[f.name]} goodWhen={f.goodWhen} />)}
        </div>
      )}
    </section>
  );
}
