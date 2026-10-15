import { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Chart, TileData } from '@/lib/canvas';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

const axisTick = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };
const tooltipStyle = {
  contentStyle: { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--foreground))' },
  itemStyle: { color: 'hsl(var(--foreground))' }, labelStyle: { color: 'hsl(var(--muted-foreground))' }, cursor: { fill: 'hsl(var(--muted) / 0.5)' },
} as const;
const PALETTE = ['hsl(var(--primary))', 'hsl(var(--sev-low))', 'hsl(var(--sev-medium))', 'hsl(var(--ok))', 'hsl(270 30% 52%)', 'hsl(190 45% 40%)', 'hsl(330 35% 52%)', 'hsl(var(--sev-high))', 'hsl(var(--sev-info))'];
const MUTED = 'hsl(var(--muted-foreground) / 0.45)';
const colour = (label: string, i: number) => (label === 'Other' || label === 'Unknown' ? MUTED : PALETTE[i % PALETTE.length]);
const Empty = ({ children = 'No data' }: { children?: React.ReactNode }) => <p className="py-8 text-center text-xs text-muted-foreground">{children}</p>;

type Row = NonNullable<TileData['rows']>[number];

export function ChartView({ chart, data, height = 200 }: { chart: Chart; data: TileData; height?: number }) {
  const rows = (data.rows ?? []) as Row[];
  const measureLabel = chart.measure.agg === 'count' ? 'Rows' : `${chart.measure.agg.replace('_', ' ')} of ${chart.measure.column ?? ''}`;

  if (chart.type === 'table') return <TableView columns={data.columns ?? []} rows={rows} capped={!!data.capped} />;
  if (chart.type === 'kpi') {
    const v = rows[0]?.value;
    return v === null || v === undefined ? <Empty>No value</Empty> : (
      <div className="py-3"><div className="font-display num text-[52px] leading-none" title={fmtNum(v, 4)}>{Math.abs(v) >= 100000 ? fmtCompact(v) : fmtNum(v, v % 1 ? 2 : 0)}</div><div className="mt-1 text-xs text-muted-foreground">{measureLabel}</div></div>
    );
  }
  if (!rows.length) return <Empty />;
  if (chart.type === 'donut') return <Donut rows={rows} />;
  if (chart.type === 'stacked') return <Stacked rows={rows} height={height} />;
  if (chart.type === 'line' || chart.type === 'area') {
    const C = chart.type === 'area' ? AreaChart : LineChart;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <C data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCompact(Number(v))} />
          <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtNum(Number(v), 2), measureLabel]} />
          {chart.type === 'area' ? <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.18)" strokeWidth={2} isAnimationActive={false} /> : <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={rows.length < 40} isAnimationActive={false} />}
        </C>
      </ResponsiveContainer>
    );
  }
  const horizontal = chart.type === 'hbar' || rows.length > 8 || rows.some((r) => r.label.length > 12);
  const h = horizontal ? Math.max(height, rows.length * 28 + 20) : height;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 14, right: 16, bottom: 0, left: horizontal ? 0 : -8 }}>
        {horizontal ? (<><XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="label" width={120} tick={axisTick} axisLine={false} tickLine={false} /></>)
          : (<><XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={0} /><YAxis tick={axisTick} axisLine={false} tickLine={false} /></>)}
        <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtNum(Number(v), 2), measureLabel]} />
        <Bar dataKey="value" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} isAnimationActive={false} label={{ position: horizontal ? 'right' : 'top', fill: 'hsl(var(--muted-foreground))', fontSize: 10, formatter: (v: any) => (v ? fmtCompact(Number(v)) : '') }}>
          {rows.map((r, i) => <Cell key={r.label + i} fill={r.label === 'Other' ? MUTED : 'hsl(var(--primary))'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Donut({ rows }: { rows: Row[] }) {
  const sum = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  if (!sum) return <Empty />;
  const pos = rows.filter((r) => (r.value ?? 0) > 0);
  return (
    <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
      <div className="relative mx-auto h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pos} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
              {pos.map((r, i) => <Cell key={r.label} fill={colour(r.label, i)} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [fmtNum(Number(v), 2), n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="num text-xl font-semibold" title={fmtNum(sum, 2)}>{fmtCompact(sum)}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">total</div></div></div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1">
        {rows.map((r, i) => (
          <li key={r.label + i} className="flex items-center gap-2 px-1.5 py-1 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colour(r.label, i) }} />
            <span className="truncate">{r.label}</span>
            <span className={cn('num ml-auto font-medium', !r.value && 'text-muted-foreground')}>{fmtNum(r.value ?? 0, 2)}</span>
            <span className="num w-10 text-right text-muted-foreground">{((((r.value ?? 0) / sum) * 100)).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stacked({ rows, height }: { rows: Row[]; height: number }) {
  const { data, series } = useMemo(() => {
    const cats = new Map<string, Record<string, number>>();
    const tot = new Map<string, number>();
    for (const r of rows) {
      const s = r.label2 ?? 'Total';
      const c = cats.get(r.label) ?? {}; c[s] = (c[s] ?? 0) + (r.value ?? 0); cats.set(r.label, c);
      tot.set(s, (tot.get(s) ?? 0) + (r.value ?? 0));
    }
    const series = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const data = [...cats.entries()].map(([name, o]) => ({ name, total: Object.values(o).reduce((a, b) => a + b, 0), ...o })).sort((a, b) => b.total - a.total).slice(0, 25);
    return { data, series };
  }, [rows]);
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, data.length * 30 + 50)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
        <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={118} tick={axisTick} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} />
        <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} />
        {series.map((s, i) => <Bar key={s} dataKey={s} stackId="a" fill={colour(s, i)} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

function TableView({ columns, rows, capped }: { columns: Array<{ name: string }>; rows: Array<Record<string, any>>; capped: boolean }) {
  if (!rows.length) return <Empty>The query returned no rows</Empty>;
  const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/T\d{2}:\d{2}:\d{2}.*$/, ''));
  return (
    <div className="overflow-auto" style={{ maxHeight: 360 }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card"><tr>{columns.map((c) => <th key={c.name} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground">{c.name}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i} className="border-t border-border/60">{columns.map((c) => { const v = r[c.name]; return <td key={c.name} className={cn('max-w-[14rem] truncate px-2 py-1.5', typeof v === 'number' && 'num text-right')} title={show(v)}>{show(v) || <span className="text-muted-foreground/50">–</span>}</td>; })}</tr>)}</tbody>
      </table>
      {(capped || rows.length > 200) && <p className="mt-1 text-[11px] text-muted-foreground">Showing the first {Math.min(rows.length, 200)} rows.</p>}
    </div>
  );
}
