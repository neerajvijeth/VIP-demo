import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Info, X } from 'lucide-react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Condition } from '@shared/types';
import { BANDS, SCORE_WEIGHTS, fillBands, groupSmall, type Band } from '@shared/bands';
import { csvRow } from '@shared/csv';
import { Badge, SEV_COLORS } from '@/components/ui/badges';
import { Popover, PopoverContent, PopoverTrigger, Sheet } from '@/components/ui/overlay';
import { Button, Card, ErrorPanel, Segmented, Skeleton } from '@/components/ui/primitives';
import { Api } from '@/lib/api';
import { lcond } from '@/lib/sem';
import { cn, downloadText, fmtCompact, fmtNum, timestamp } from '@/lib/utils';
import { useExecCross } from '@/store/execCross';
import { Donut, KpiCard, WidgetCard, axisTick, num, tooltipStyle } from './widgets';
import { useWidget, type Row } from './data';

type Drill = (entity: 'assets' | 'vulnerabilities', ...extra: Condition[]) => void;
interface Props { drill: Drill; openConds: () => Condition[] }

const BAND_KEY: Record<Band['label'], 'critical' | 'high' | 'medium' | 'low'> = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' };
const bandColor = (l: string) => SEV_COLORS[BAND_KEY[l as Band['label']] ?? 'info'];
const PRIORITY: Record<string, string> = { '1': 'Critical', '2': 'High', '3': 'Medium', '4': 'Low' };
const compact = (n: number) => (n >= 10000 ? fmtCompact(n) : fmtNum(n));

function Header({ title, subtitle, right }: { title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div><h2 className="font-display text-[26px] leading-none">{title}</h2><p className="mt-1.5 text-xs text-muted-foreground">{subtitle}</p></div>
      {right}
    </div>
  );
}

/** Horizontal bars with data labels; optional click and a tooltip with extra lines. */
function HBar({ data, onSelect, selected, valueLabel, extra, empty = 'No matching records for the current filters.' }: {
  data: Array<{ label: string; value: number; [k: string]: any }>;
  onSelect?: (label: string) => void;
  selected?: string | null;
  valueLabel: string;
  extra?: (d: any) => string[];
  empty?: string;
}) {
  if (!data.length || data.every((d) => !d.value)) return <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
        <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={150} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: string) => (v.length > 24 ? v.slice(0, 23) + '…' : v)} />
        <Tooltip {...tooltipStyle} content={({ active, payload }: any) => active && payload?.[0] ? (
          <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow">
            <div className="font-medium">{payload[0].payload.label}</div>
            <div className="num">{valueLabel}: <b>{fmtNum(payload[0].payload.value, payload[0].payload.value % 1 ? 1 : 0)}</b></div>
            {(extra?.(payload[0].payload) ?? []).map((l) => <div key={l} className="num text-muted-foreground">{l}</div>)}
          </div>) : null} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false} cursor={onSelect ? 'pointer' : undefined} onClick={(d: any) => onSelect?.(d.label ?? d.payload?.label)}>
          {data.map((d) => <Cell key={d.label} fill={d.label === 'Other' ? 'hsl(var(--muted-foreground) / 0.45)' : 'hsl(var(--primary))'} fillOpacity={selected && selected !== d.label ? 0.35 : 1} />)}
          <LabelList dataKey="value" position="right" fill="hsl(var(--muted-foreground))" fontSize={11} formatter={(v: any) => (v ? fmtNum(Number(v), Number(v) % 1 ? 1 : 0) : '')} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------- Section 1
function AssetOverview({ drill }: Props) {
  const order = ['Workstation', 'Server', 'Unknown'];
  return (
    <section aria-label="Asset overview and server classification">
      <Header title="Asset overview" subtitle="Unique assets and how many are servers (mobile devices excluded)" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard id="execTotals" title="Total unique assets" pick={(r) => ({ value: num(r[0]?.total), sub: 'distinct asset ids, excl. Android / iOS' })} goodWhen="neutral" onClick={() => drill('assets')} />
        <KpiCard id="execTotals" title="Total servers" pick={(r) => ({ value: num(r[0]?.servers), sub: 'asset class = Server' })} goodWhen="neutral" onClick={() => drill('assets', lcond('asset_class', 'is', 'Server'))} />
        <KpiCard id="execTotals" title="Servers as % of assets" pick={(r) => { const t = num(r[0]?.total), s = num(r[0]?.servers); return { value: t ? (s / t) * 100 : 0, pct: true, sub: `${fmtNum(s)} of ${fmtNum(t)} assets` }; }} goodWhen="neutral" />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-12">
        <WidgetCard ids={['execByClass']} title="Assets by class" subtitle="Workstation, Server and Unknown" className="lg:col-span-5">
          {(r) => {
            const rows = r.execByClass.map((x) => ({ name: String(x.label), value: num(x.value) }));
            const data = [...order.map((n) => rows.find((x) => x.name === n)).filter(Boolean) as typeof rows, ...rows.filter((x) => !order.includes(x.name))];
            const known = data.map((d) => d.name).filter((n) => n !== 'Unknown');
            return <Donut data={data} onSelect={(n) => drill('assets', n === 'Unknown' ? lcond('asset_class', 'is none of', known) : lcond('asset_class', 'is', n))} />;
          }}
        </WidgetCard>
        <WidgetCard ids={['execServersByOs']} title="Servers by operating system" subtitle="Asset class = Server · more than 10 groups fold into Other" className="lg:col-span-7">
          {(r) => <HBar data={groupSmall(r.execServersByOs.map((x) => ({ label: String(x.label), value: num(x.value) })), 10)} valueLabel="Servers" empty="No servers match the current filters." />}
        </WidgetCard>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Section 2
function ServerScores({ drill, openConds }: Props) {
  const srv = lcond('asset_class', 'is', 'Server');
  const bandDrill = (b: Band) => drill('vulnerabilities', ...openConds(), srv, b.min !== undefined && b.max !== undefined ? lcond('final_score', 'between', [b.min, b.max + 0.999]) : b.min !== undefined ? lcond('final_score', '≥', b.min) : lcond('final_score', '<', 50));
  const pickBand = (b: Band) => (r: Row[]) => ({ value: num(r.find((x) => x.label === b.label)?.value), sub: `score ${b.range}` });
  const info = (
    <Popover>
      <PopoverTrigger asChild><button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Risk score weights" title="Risk score weights"><Info size={14} /></button></PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-xs">
        <div className="mb-1.5 font-medium">Risk score weights</div>
        <ul className="space-y-1">{SCORE_WEIGHTS.map(([n, w]) => <li key={n} className="flex justify-between"><span>{n}</span><b className="num">{w}%</b></li>)}</ul>
        <p className="mt-2 text-muted-foreground">Reference only. The score on each vulnerability is precomputed upstream (final_score).</p>
      </PopoverContent>
    </Popover>
  );
  return (
    <section aria-label="Server vulnerability score distribution">
      <Header title="Server vulnerabilities by score" subtitle="Open unique vulnerabilities on servers (distinct asset + CVE), banded by risk score" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {BANDS.map((b) => <KpiCard key={b.label} id="execServerBands" title={`${b.label} · servers`} tone={BAND_KEY[b.label]} goodWhen="down" pick={pickBand(b)} onClick={() => bandDrill(b)} />)}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-12">
        <WidgetCard ids={['execServerBands']} title="Distribution by band" subtitle="Critical to Low; empty bands show 0" className="lg:col-span-6">
          {(r) => {
            const data = fillBands(r.execServerBands.map((x) => ({ label: String(x.label), value: num(x.value) })));
            return (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: -12 }}>
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => [fmtNum(Number(v)), 'Unique vulnerabilities']} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={(d: any) => { const b = BANDS.find((x) => x.label === (d.label ?? d.payload?.label)); if (b) bandDrill(b); }} label={{ position: 'top', fill: 'hsl(var(--muted-foreground))', fontSize: 11, formatter: (v: any) => fmtNum(Number(v)) }}>
                    {data.map((d) => <Cell key={d.label} fill={bandColor(d.label)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            );
          }}
        </WidgetCard>
        <Card className="p-4 lg:col-span-6">
          <div className="mb-3 flex items-start justify-between"><div><h3 className="font-display text-[19px] leading-6">Score bands and SLA</h3><p className="mt-0.5 text-xs text-muted-foreground">Remediation targets per band</p></div>{info}</div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="pb-1.5 font-medium">Band</th><th className="pb-1.5 font-medium">Score</th><th className="pb-1.5 font-medium">SLA</th></tr></thead>
            <tbody>{BANDS.map((b) => (
              <tr key={b.label} className="border-t border-border/60"><td className="py-1.5"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: bandColor(b.label) }} />{b.label}</span></td><td className="num py-1.5">{b.range}</td><td className="py-1.5">{b.sla}</td></tr>
            ))}</tbody>
          </table>
        </Card>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard id="execServerKpis" title="Servers with KEV" tone="critical" pick={(r) => ({ value: num(r[0]?.servers_kev), sub: 'servers with a known-exploited vuln' })} onClick={() => drill('vulnerabilities', ...openConds(), srv, lcond('kev_flag', 'is true'))} />
        <KpiCard id="execServerKpis" title="Servers with SLA breach" tone="high" pick={(r) => ({ value: num(r[0]?.servers_breach), sub: 'at least one vuln past SLA' })} onClick={() => drill('vulnerabilities', ...openConds(), srv, lcond('sla_breached', 'is true'))} />
        <SlaBreachPct />
      </div>
    </section>
  );
}
/** % of servers in scope that have an SLA breach: needs the server total from Section 1's widget. */
function SlaBreachPct() {
  const k = useWidget('execServerKpis');
  const t = useWidget('execTotals');
  const total = num(t.rows?.[0]?.servers), breach = num(k.rows?.[0]?.servers_breach);
  return <KpiCard id="execServerKpis" title="Server SLA breach rate" tone="high" pick={() => ({ value: total ? (breach / total) * 100 : 0, pct: true, sub: `${fmtNum(breach)} of ${fmtNum(total)} servers` })} />;
}

// ---------------------------------------------------------------- Section 3
function TopApplications({ drill, openConds }: Props) {
  const [by, setBy] = useState<'count' | 'score'>('count');
  const sel = useExecCross((s) => s.software);
  const setSel = useExecCross((s) => s.set);
  const id = by === 'count' ? 'execAppsByCount' : 'execAppsByScore';
  const toggle = (label: string) => setSel(sel === label ? null : label);
  return (
    <section aria-label="Top applications">
      <Header title="Top applications by vulnerabilities" subtitle="Unique open vulnerabilities per software · click a bar or row to narrow the server table below"
        right={<Segmented size="sm" ariaLabel="Ranking" value={by} onChange={setBy} options={[{ value: 'count', label: 'By vulnerability count' }, { value: 'score', label: 'By max risk score' }]} />} />
      <div className="grid gap-3 lg:grid-cols-12">
        <WidgetCard ids={[id]} title="Top 10 applications" subtitle={by === 'count' ? 'Ranked by unique vulnerabilities' : 'Ranked by highest risk score'} className="lg:col-span-5">
          {(r) => <HBar data={r[id].map((x) => ({ label: String(x.software_name), value: by === 'count' ? num(x.vulns) : num(x.max_score), vulns: num(x.vulns), assets: num(x.assets), kev: num(x.kev) }))} selected={sel} onSelect={toggle} valueLabel={by === 'count' ? 'Unique vulnerabilities' : 'Max risk score'} extra={(d) => [`Affected assets: ${fmtNum(d.assets)}`, `Vulnerabilities: ${fmtNum(d.vulns)}`, `KEV: ${fmtNum(d.kev)}`]} />}
        </WidgetCard>
        <WidgetCard ids={[id]} title="Application detail" subtitle="Software, vulnerabilities, assets, KEV, risk and priority" className="lg:col-span-7">
          {(r) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-muted-foreground"><th className="pb-1.5 text-left font-medium">Software</th><th className="px-1.5 pb-1.5 text-right font-medium">Vulns</th><th className="px-1.5 pb-1.5 text-right font-medium">Assets</th><th className="px-1.5 pb-1.5 text-right font-medium">KEV</th><th className="px-1.5 pb-1.5 text-right font-medium">Max score</th><th className="px-1.5 pb-1.5 text-left font-medium">Highest priority</th></tr></thead>
                <tbody>
                  {r[id].map((x) => {
                    const name = String(x.software_name), p = PRIORITY[String(num(x.prank))];
                    return (
                      <tr key={name} tabIndex={0} onClick={() => toggle(name)} onKeyDown={(e) => e.key === 'Enter' && toggle(name)} className={cn('cursor-pointer border-t border-border/60 hover:bg-muted/60', sel === name && 'bg-accent')}>
                        <td className="max-w-[14rem] truncate py-1.5" title={name}>{name}</td>
                        <td className="num px-1.5 text-right">{fmtNum(num(x.vulns))}</td>
                        <td className="num px-1.5 text-right">{fmtNum(num(x.assets))}</td>
                        <td className={cn('num px-1.5 text-right', !num(x.kev) && 'text-muted-foreground')}>{fmtNum(num(x.kev))}</td>
                        <td className="num px-1.5 text-right">{x.max_score === null || x.max_score === undefined ? '–' : fmtNum(num(x.max_score), 1)}</td>
                        <td className="px-1.5">{p ? <Badge tone={BAND_KEY[p as Band['label']]}>{p}</Badge> : <span className="text-muted-foreground">–</span>}</td>
                      </tr>
                    );
                  })}
                  {!r[id].length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No matching records for the current filters.</td></tr>}
                </tbody>
              </table>
              <button className="mt-2 text-xs text-primary hover:underline" onClick={() => drill('vulnerabilities', ...openConds())}>Open all findings</button>
            </div>
          )}
        </WidgetCard>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Section 4
type Key = 'hostname' | 'os' | 'business_unit' | 'region' | 'criticality' | 'internet' | 'total' | 'critical' | 'high' | 'medium' | 'low' | 'kev' | 'max_score';
const COLS: Array<{ key: Key; label: string; num?: boolean }> = [
  { key: 'hostname', label: 'Hostname' }, { key: 'os', label: 'OS' }, { key: 'business_unit', label: 'Business unit' }, { key: 'region', label: 'Region' },
  { key: 'criticality', label: 'Asset criticality' }, { key: 'internet', label: 'Internet' }, { key: 'total', label: 'Total', num: true }, { key: 'critical', label: 'Critical', num: true },
  { key: 'high', label: 'High', num: true }, { key: 'medium', label: 'Medium', num: true }, { key: 'low', label: 'Low', num: true }, { key: 'kev', label: 'KEV', num: true }, { key: 'max_score', label: 'Max score', num: true },
];

function ServerDetail({ server, onClose, drill, openConds }: { server: Row | null } & { onClose: () => void } & Props) {
  const id = String(server?.gold_asset_id ?? '');
  const q = useQuery({
    queryKey: ['exec-server-detail', id],
    enabled: !!server,
    retry: 0,
    queryFn: ({ signal }) => Api.run({
      entity: 'vulnerabilities',
      tree: { type: 'group', op: 'AND', not: false, children: [lcond('gold_asset_id', 'is', id), ...openConds()] },
      columns: ['vulnerability_name', 'cve', 'severity', 'final_score', 'kev_flag', 'sla_status', 'software_name'],
      sort: { field: 'final_score', dir: 'desc' }, page: 0, pageSize: 15, options: { latestSnapshotOnly: true },
    }, signal),
  });
  return (
    <Sheet open={!!server} onOpenChange={(o) => !o && onClose()} title={String(server?.hostname ?? 'Server')} description="Top open vulnerabilities by risk score" width="max-w-3xl">
      {server && (
        <div className="space-y-3 p-5 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            {([['OS', server.os], ['Business unit', server.business_unit], ['Region', server.region], ['Criticality', server.criticality], ['Internet exposed', num(server.internet) ? 'Yes' : 'No'], ['Unique vulnerabilities', fmtNum(num(server.total))]] as const).map(([k, v]) => <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{String(v ?? '–')}</dd></div>)}
          </dl>
          {q.isLoading ? <Skeleton className="h-48" /> : q.isError ? <ErrorPanel message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-2 py-1.5 font-medium">Vulnerability</th><th className="px-2 font-medium">CVE</th><th className="px-2 font-medium">Severity</th><th className="px-2 text-right font-medium">Score</th><th className="px-2 font-medium">KEV</th><th className="px-2 font-medium">SLA</th></tr></thead>
                <tbody>{(q.data?.rows ?? []).map((r, i) => (
                  <tr key={i} className="border-t border-border/60"><td className="max-w-[16rem] truncate px-2 py-1.5" title={String(r.vulnerability_name ?? '')}>{String(r.vulnerability_name ?? '–')}</td><td className="mono px-2">{String(r.cve ?? '–')}</td><td className="px-2">{String(r.severity ?? '–')}</td><td className="num px-2 text-right">{r.final_score == null ? '–' : fmtNum(num(r.final_score), 1)}</td><td className="px-2">{r.kev_flag ? <Badge tone="critical">KEV</Badge> : '–'}</td><td className="px-2">{String(r.sla_status ?? '–')}</td></tr>
                ))}</tbody>
              </table>
              {(q.data?.rows.length ?? 0) === 0 && <p className="p-4 text-center text-xs text-muted-foreground">No open vulnerabilities.</p>}
            </div>
          )}
          <Button size="sm" onClick={() => { onClose(); drill('vulnerabilities', ...openConds(), lcond('gold_asset_id', 'is', id)); }}>Open all in Vulnerabilities</Button>
        </div>
      )}
    </Sheet>
  );
}

function TopServers(props: Props) {
  const sw = useExecCross((s) => s.software);
  const setSw = useExecCross((s) => s.set);
  const [sort, setSort] = useState<{ key: Key; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' });
  const [open, setOpen] = useState<Row | null>(null);
  const setKey = (key: Key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const sorted = (rows: Row[]) => [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    const c = typeof av === 'number' || typeof bv === 'number' || COLS.find((x) => x.key === sort.key)?.num ? num(av) - num(bv) : String(av ?? '').localeCompare(String(bv ?? ''));
    return sort.dir === 'asc' ? c : -c;
  });
  const exportCsv = (rows: Row[]) => {
    downloadText(`top_servers_${timestamp()}.csv`, csvRow(COLS.map((c) => c.label)) + sorted(rows).map((r) => csvRow(COLS.map((c) => (c.key === 'internet' ? (num(r.internet) ? 'Yes' : 'No') : r[c.key])))).join(''));
  };
  return (
    <section aria-label="Top servers">
      <Header title="Top servers by vulnerabilities" subtitle="Servers with the most open unique vulnerabilities · click a row for details"
        right={sw ? <button className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent px-2.5 py-1 text-xs" onClick={() => setSw(null)} aria-label={`Remove application filter ${sw}`}>Application: <b className="font-medium">{sw}</b><X size={12} /></button> : undefined} />
      <div className="grid gap-3">
        <WidgetCard ids={['execTopServers']} title="Top 10 servers" subtitle="Open unique vulnerabilities per server">
          {(r) => <HBar data={r.execTopServers.slice(0, 10).map((x) => ({ label: String(x.hostname ?? x.gold_asset_id), value: num(x.total), critical: num(x.critical), high: num(x.high), kev: num(x.kev) }))} valueLabel="Unique vulnerabilities" extra={(d) => [`Critical ${d.critical} · High ${d.high}`, `KEV ${d.kev}`]} onSelect={(l) => setOpen(r.execTopServers.find((x) => String(x.hostname ?? x.gold_asset_id) === l) ?? null)} />}
        </WidgetCard>
        <WidgetCard ids={['execTopServers']} title="Server detail table" subtitle="Top 25 servers · click a column to sort, a row for details">
          {(r) => {
            const rows = sorted(r.execTopServers);
            if (!rows.length) return <p className="py-8 text-center text-xs text-muted-foreground">No matching records for the current filters.</p>;
            return (
              <div>
                <div className="mb-2 flex justify-end"><Button size="sm" onClick={() => exportCsv(r.execTopServers)}><Download size={13} /> Export CSV</Button></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr>{COLS.map((c) => (
                      <th key={c.key} className={cn('whitespace-nowrap px-1.5 pb-1.5 font-medium text-muted-foreground', c.num ? 'text-right' : 'text-left')} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                        <button className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => setKey(c.key)}>{c.label}{sort.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}</button>
                      </th>))}</tr></thead>
                    <tbody>{rows.map((x) => (
                      <tr key={String(x.gold_asset_id)} tabIndex={0} onClick={() => setOpen(x)} onKeyDown={(e) => e.key === 'Enter' && setOpen(x)} className="cursor-pointer border-t border-border/60 hover:bg-muted/60">
                        {COLS.map((c) => (
                          <td key={c.key} className={cn('max-w-[11rem] truncate px-1.5 py-1.5', c.num && 'num text-right', c.key === 'hostname' && 'mono', ['critical', 'high', 'medium', 'low', 'kev'].includes(c.key) && !num(x[c.key]) && 'text-muted-foreground')} title={String(x[c.key] ?? '')}>
                            {c.key === 'internet' ? (num(x.internet) ? <Badge tone="high">Yes</Badge> : 'No') : c.key === 'max_score' ? (x.max_score == null ? '–' : fmtNum(num(x.max_score), 1)) : c.num ? compact(num(x[c.key])) : String(x[c.key] ?? '–')}
                          </td>))}
                      </tr>))}</tbody>
                  </table>
                </div>
              </div>
            );
          }}
        </WidgetCard>
      </div>
      <ServerDetail server={open} onClose={() => setOpen(null)} {...props} />
    </section>
  );
}

/** The four executive sections, in order. They share the page's filters, so every number changes together with them. */
export function ExecSections(props: Props) {
  return (
    <>
      <AssetOverview {...props} />
      <ServerScores {...props} />
      <TopApplications {...props} />
      <TopServers {...props} />
    </>
  );
}
