import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Download, Info, Minus, RefreshCw, Table2 } from 'lucide-react';
import { Card, ErrorPanel, Skeleton } from '@/components/ui/primitives';
import { Badge, SEV_COLORS, SEVERITY_ORDER, sevKey, toneOf } from '@/components/ui/badges';
import { cn, downloadText, fmtNum, timestamp } from '@/lib/utils';
import { csvRow } from '@shared/csv';
import { useWidget, type Row } from './data';
import { toast } from '@/store/toast';
import { NotAppliedPill } from './NotApplied';

// ---------- helpers ----------
export function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const cur = a + (target - a) * e;
      setV(cur);
      from.current = cur;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export const axisTick = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };
export const tooltipStyle = {
  contentStyle: { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--foreground))' },
  itemStyle: { color: 'hsl(var(--foreground))' },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
  cursor: { fill: 'hsl(var(--muted) / 0.5)' },
} as const;

const RAMP = ['hsl(var(--primary))', 'hsl(var(--primary) / 0.6)', 'hsl(var(--primary) / 0.38)', 'hsl(var(--primary) / 0.22)'];
export const colorFor = (label: string, i: number) => {
  const l = label.toLowerCase();
  if (['critical', 'high', 'medium', 'low', 'info'].includes(l)) return SEV_COLORS[l as keyof typeof SEV_COLORS];
  const t = toneOf(label);
  if (t === 'ok') return 'hsl(var(--ok))';
  if (t) return SEV_COLORS[t];
  return RAMP[i % RAMP.length];
};
export const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

// ---------- widget shell ----------
function rowsToCsv(rows: Row[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return csvRow(cols) + rows.map((r) => csvRow(cols.map((c) => r[c]))).join('');
}

export function MiniTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="py-6 text-center text-xs text-muted-foreground">No data</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>{cols.map((c) => <th key={c} className="sticky top-0 bg-card px-2 py-1.5 text-left font-medium text-muted-foreground">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">{cols.map((c) => <td key={c} className="num px-2 py-1.5">{String(r[c] ?? '')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card chrome for one or more widgets: skeleton, inline error, "view as table", CSV and timing. */
export function WidgetCard({ ids, title, subtitle, className, children, bodyClass }: {
  ids: string[];
  title: string;
  subtitle?: ReactNode;
  className?: string;
  children: (rows: Record<string, Row[]>) => ReactNode;
  bodyClass?: string;
}) {
  const states = ids.map((id) => useWidget(id)); // eslint-disable-line react-hooks/rules-of-hooks -- ids are static per call site
  const [asTable, setAsTable] = useState(false);
  const loading = states.some((s) => s.loading);
  const error = states.find((s) => s.error)?.error;
  const unavailable = states.find((s) => s.unavailable)?.unavailable;
  const fetching = states.some((s) => s.fetching);
  const byId = Object.fromEntries(ids.map((id, i) => [id, states[i].rows ?? []]));
  const ms = Math.max(0, ...states.map((s) => s.elapsedMs ?? 0));
  // fixed filters this card's table has no column for (shown instead of silently ignoring them)
  const ignored = [...new Set(states.flatMap((s) => s.ignoredFilters ?? []))].map((f) => ({ id: f, label: f.replace(/_/g, ' '), text: '' }));

  const download = () => {
    ids.forEach((id) => {
      const rows = byId[id];
      if (!rows.length) return;
      downloadText(`overview_${id}_${timestamp()}.csv`, rowsToCsv(rows));
    });
    toast.success('CSV downloaded', 'Built from the widget query result (current filters).');
  };

  return (
    <Card className={cn('flex min-w-0 flex-col p-4', className)} aria-busy={loading}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[19px] leading-6">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          <NotAppliedPill className="mt-1" items={ignored} reason="This card's table has no such column, so the filter cannot narrow it." />
        </div>
        <div className="no-print flex shrink-0 items-center gap-0.5 text-muted-foreground">
          {fetching && !loading && <RefreshCw size={12} className="mr-1 animate-spin" aria-label="Refreshing" />}
          <button className={cn('rounded p-1 hover:bg-muted hover:text-foreground', asTable && 'bg-muted text-foreground')} onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} aria-label="View as table" title="View as table">
            <Table2 size={14} />
          </button>
          <button className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={download} disabled={loading || !!error} aria-label="Download CSV" title={ms ? `Download CSV (query ran in ${ms} ms)` : 'Download CSV'}>
            <Download size={14} />
          </button>
        </div>
      </div>
      <div className={cn('min-h-0 flex-1', bodyClass, fetching && !loading && 'opacity-70 transition-opacity')}>
        {loading ? (
          <div className="space-y-2"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-28 w-full" /></div>
        ) : unavailable ? (
          <p className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-4 text-xs text-muted-foreground"><Info size={14} className="mt-0.5 shrink-0" /> {unavailable}</p>
        ) : error ? (
          <ErrorPanel message={error} onRetry={states[0].refetch} />
        ) : asTable ? (
          <div className="space-y-3">{ids.map((id) => <MiniTable key={id} rows={byId[id]} />)}</div>
        ) : (
          children(byId)
        )}
      </div>
    </Card>
  );
}

// ---------- KPI ----------
export function Sparkline({ data, color = 'hsl(var(--primary))', height = 32 }: { data: { v: number | null }[]; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Delta({ now, prev, goodWhen = 'down', suffix = '' }: { now: number; prev: number | null | undefined; goodWhen?: 'up' | 'down' | 'neutral'; suffix?: string }) {
  if (prev === null || prev === undefined || !Number.isFinite(prev)) return null;
  const d = now - prev;
  if (Math.abs(d) < 1e-9) return <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"><Minus size={11} /> no change</span>;
  const up = d > 0;
  const good = goodWhen === 'neutral' ? null : (goodWhen === 'down') === !up;
  return (
    <span className={cn('num inline-flex items-center gap-0.5 text-[11px] font-medium', good === null ? 'text-muted-foreground' : good ? 'text-ok' : 'text-sev-critical')}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {fmtNum(Math.abs(d), Math.abs(d) < 10 ? 1 : 0)}{suffix}
    </span>
  );
}

export function KpiCard({ id, title, hint, pick, onClick, tone, series, goodWhen = 'down' }: {
  id: string;
  title: string;
  hint?: string;
  pick: (rows: Row[]) => { value: number; pct?: boolean; sub?: string };
  onClick?: () => void;
  tone?: 'critical' | 'high' | 'medium' | 'low' | 'primary';
  series?: { date: string; value: number | null }[];
  goodWhen?: 'up' | 'down' | 'neutral';
  icon?: ReactNode;
}) {
  const w = useWidget(id);
  const picked = w.rows ? pick(w.rows) : null;
  const shown = useCountUp(picked?.value ?? 0);
  const prev = series && series.length > 1 ? series[series.length - 2].value : null;
  const TONE: Record<string, string> = { critical: 'hsl(var(--sev-critical))', high: 'hsl(var(--sev-high))', medium: 'hsl(var(--sev-medium))', low: 'hsl(var(--sev-low))' };
  const color = (tone && TONE[tone]) || 'hsl(var(--muted-foreground))';

  return (
    <Card className={cn('group relative flex flex-col justify-between p-4 transition-colors duration-150', onClick && 'cursor-pointer hover:border-foreground/30')} aria-busy={w.loading}>
      <button className="absolute inset-0 rounded-lg" onClick={onClick} disabled={!onClick || !picked} aria-label={`${title}: open in query builder`} tabIndex={onClick ? 0 : -1} />
      <div className="pointer-events-none">
        <div className="eyebrow truncate">{title}</div>
        {w.loading ? (
          <Skeleton className="mt-3 h-10 w-24" />
        ) : w.unavailable ? (
          <div className="mt-3 text-xs text-muted-foreground" title={w.unavailable}>Not available</div>
        ) : w.error ? (
          <div className="mt-2 text-xs text-sev-critical" title={w.error}>Failed to load</div>
        ) : picked ? (
          <>
            <div className="font-display num mt-1 text-[44px] leading-[1.05]" style={tone && TONE[tone] && (picked?.value ?? 0) > 0 ? { color: TONE[tone] } : undefined}>
              {picked.pct ? `${shown.toFixed(1)}%` : fmtNum(Math.round(shown))}
            </div>
            <div className="mt-1 flex min-h-4 items-center gap-2 text-[11px] text-muted-foreground">
              {picked.sub && <span>{picked.sub}</span>}
              {series && !picked.pct && <Delta now={picked.value} prev={prev} goodWhen={goodWhen} />}
            </div>
          </>
        ) : null}
      </div>
      <div className="pointer-events-none mt-3 h-7">
        {series && series.length > 1 && !w.loading && <Sparkline data={series.map((p) => ({ v: p.value }))} color={color} height={28} />}
      </div>
      {hint && <span className="sr-only">{hint}</span>}
    </Card>
  );
}

// ---------- charts ----------
export function Donut({ data, onSelect, total }: { data: { name: string; value: number }[]; onSelect?: (name: string) => void; total?: number }) {
  const sum = total ?? data.reduce((s, d) => s + d.value, 0);
  if (!sum) return <p className="py-8 text-center text-xs text-muted-foreground">No data</p>;
  return (
    <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
      <div className="relative mx-auto h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="100%" paddingAngle={2} stroke="none" onClick={(d: any) => onSelect?.(d.name)} cursor={onSelect ? 'pointer' : undefined} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={d.name} fill={colorFor(d.name, i)} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [fmtNum(Number(v)), n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><div className="num text-xl font-semibold">{fmtNum(sum)}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">total</div></div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1">
        {data.map((d, i) => (
          <li key={d.name}>
            <button className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted" onClick={() => onSelect?.(d.name)} disabled={!onSelect}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorFor(d.name, i) }} />
              <span className="truncate">{d.name}</span>
              <span className="num ml-auto font-medium">{fmtNum(d.value)}</span>
              <span className="num w-10 text-right text-muted-foreground">{((d.value / sum) * 100).toFixed(0)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BucketBars({ data, color = 'hsl(var(--primary))', onSelect }: { data: { label: string; value: number }[]; color?: string; onSelect?: (label: string) => void }) {
  if (!data.some((d) => d.value)) return <p className="py-8 text-center text-xs text-muted-foreground">No data</p>;
  return (
    <ResponsiveContainer width="100%" height={168}>
      <BarChart data={data} margin={{ top: 14, right: 4, bottom: 0, left: -18 }}>
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtNum(Number(v)), 'Findings']} />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} onClick={(d: any) => onSelect?.(d.label)} cursor={onSelect ? 'pointer' : undefined} isAnimationActive={false} label={{ position: 'top', fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StackedBar({ segments, onSelect }: { segments: { label: string; value: number; color: string }[]; onSelect?: (label: string) => void }) {
  const sum = segments.reduce((s, x) => s + x.value, 0);
  if (!sum) return <p className="py-6 text-center text-xs text-muted-foreground">No data</p>;
  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-md bg-muted">
        {segments.filter((s) => s.value > 0).map((s) => (
          <button key={s.label} title={`${s.label}: ${fmtNum(s.value)} (${((s.value / sum) * 100).toFixed(1)}%)`} onClick={() => onSelect?.(s.label)} className="h-full min-w-[2px] transition-[filter] hover:brightness-125" style={{ width: `${(s.value / sum) * 100}%`, background: s.color }} aria-label={`${s.label} ${s.value}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
        {segments.map((s) => (
          <li key={s.label}>
            <button className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted" onClick={() => onSelect?.(s.label)} disabled={!onSelect}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
              <span className="num ml-auto font-medium">{fmtNum(s.value)}</span>
              <span className="num w-9 text-right text-muted-foreground">{((s.value / sum) * 100).toFixed(0)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal stacked bars: one bar per business unit, stacked by severity. */
export function SeverityStack({ rows, groupKey, onSelect }: { rows: Row[]; groupKey: string; onSelect?: (group: string, severity: string) => void }) {
  const groups = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const g = String(r[groupKey] ?? 'Unassigned');
    const o = groups.get(g) ?? {};
    o[String(r.severity)] = (o[String(r.severity)] ?? 0) + num(r.value);
    groups.set(g, o);
  }
  const data = [...groups.entries()].map(([name, o]) => ({ name, ...o, total: Object.values(o).reduce((s, x) => s + x, 0) })).sort((a, b) => b.total - a.total);
  if (!data.length) return <p className="py-8 text-center text-xs text-muted-foreground">No data</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
        <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={118} tick={axisTick} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} />
        {SEVERITY_ORDER.map((s) => (
          <Bar key={s} dataKey={s} stackId="a" fill={SEV_COLORS[sevKey(s)]} cursor={onSelect ? 'pointer' : undefined} isAnimationActive={false} onClick={(d: any) => onSelect?.(d.name, s)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export type Col = { key: string; label: string; align?: 'right'; render?: (row: Row) => ReactNode; mono?: boolean; className?: string };
export function TopTable({ rows, columns, onRow }: { rows: Row[]; columns: Col[]; onRow?: (row: Row) => void }) {
  if (!rows.length) return <p className="py-8 text-center text-xs text-muted-foreground">No data</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="w-6 pb-1.5 text-left font-medium text-muted-foreground">#</th>
            {columns.map((c) => <th key={c.key} className={cn('pb-1.5 px-1.5 font-medium text-muted-foreground', c.align === 'right' ? 'text-right' : 'text-left')}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} tabIndex={onRow ? 0 : undefined} onClick={() => onRow?.(r)} onKeyDown={(e) => e.key === 'Enter' && onRow?.(r)} className={cn('border-t border-border/60', onRow && 'cursor-pointer hover:bg-muted/60')}>
              <td className="num py-1.5 text-muted-foreground">{i + 1}</td>
              {columns.map((c) => (
                <td key={c.key} className={cn('max-w-[14rem] truncate px-1.5 py-1.5', c.align === 'right' && 'num text-right', c.mono && 'mono', c.className)} title={String(r[c.key] ?? '')}>
                  {c.render ? c.render(r) : String(r[c.key] ?? '–')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const CritBadge = ({ value }: { value: unknown }) => {
  const t = toneOf(value);
  return value ? <Badge tone={t === 'ok' || !t ? 'neutral' : t}>{String(value)}</Badge> : <span>–</span>;
};

export function Meter({ label, value, total, color = 'hsl(var(--primary))', onClick }: { label: string; value: number; total: number; color?: string; onClick?: () => void }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <button className="block w-full rounded px-1 py-1 text-left hover:bg-muted disabled:hover:bg-transparent" onClick={onClick} disabled={!onClick}>
      <div className="flex items-baseline justify-between text-xs"><span>{label}</span><span className="num text-muted-foreground"><b className="text-foreground">{fmtNum(value)}</b> · {pct.toFixed(0)}%</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full rounded transition-all duration-500" style={{ width: `${pct}%`, background: color }} /></div>
    </button>
  );
}
