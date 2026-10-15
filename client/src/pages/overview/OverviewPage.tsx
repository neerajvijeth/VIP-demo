import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Activity, Printer, RefreshCw } from 'lucide-react';
import type { Condition, Entity } from '@shared/types';
import { filtersToTree, countActiveFilters, derivedExtras } from '@shared/filters';
import { Button } from '@/components/ui/primitives';
import { SEVERITY_ORDER } from '@/components/ui/badges';
import { GlobalFilterBar } from './GlobalFilterBar';
import { OverviewDataProvider } from './data';
import { TrendsRow, useKpiSeries, type Series } from './Trends';
import { BreakdownCard } from './Breakdown';
import { ExecSections } from './ExecSections';
import { DataCheckBanner } from './DataCheckBanner';
import { freshFlag } from '@/lib/api';
import { BucketBars, CritBadge, Donut, KpiCard, Meter, SeverityStack, StackedBar, TopTable, WidgetCard, colorFor, num } from './widgets';
import { filtersToSearch, searchToFilters, useFilters } from '@/store/filters';
import { useOpenBuilder, useRefreshed } from '@/lib/hooks';
import { critHighCond, lcond, openCond } from '@/lib/sem';
import { semantics } from '@shared/semantics';
import { fmtNum } from '@/lib/utils';
import { toast } from '@/store/toast';

/** Click-through filter for "open": same idea as the cards (open state, no duplicates). */
const OPEN = (): Condition[] => [openCond(), lcond('deduplication_status', 'is not', 'Duplicate')];
/** A chart's Unknown bucket (NULL / empty) is everything that is not one of the known labels. */
const eqOrUnknown = (field: string, label: string, known: string[]) => (label.startsWith('Unknown') ? lcond(field, 'is none of', known) : lcond(field, 'is', label));
const CRIT_HIGH = critHighCond;
const BUCKETS: Record<string, [number, number | null]> = { '1-30': [1, 30], '31-60': [31, 60], '61-90': [61, 90], '90+': [91, null], '0-30': [0, 30], '91-180': [91, 180], '180+': [181, null] };

function sumSeries(...list: (Series | undefined)[]): Series | undefined {
  if (list.some((s) => !s)) return undefined;
  const [first, ...others] = list as Series[];
  return first.map((p, i) => ({ date: p.date, value: p.value === null ? null : p.value + others.reduce((s, o) => s + (o[i]?.value ?? 0), 0) }));
}
const ordered = (rows: { label: string; value: number }[], order: string[]) =>
  order.map((l) => ({ label: l, value: rows.find((r) => r.label === l)?.value ?? 0 }));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="sr-only">{title}</h2>
      {children}
    </section>
  );
}

function PageBody() {
  const { filters, options } = useFilters();
  const open = useOpenBuilder();
  const kpis = useKpiSeries();
  const m = kpis.data?.metrics;
  const unfiltered = countActiveFilters(filters) === 0;
  const s = (name: string) => (unfiltered ? m?.[name] : undefined);

  /** Click-through: current global filters + the clicked segment → pre-filled builder. */
  const drill = (entity: Entity, ...extra: Condition[]) => {
    const base = filtersToTree(filters);
    // filters you added: the ones on this page's own table go along; a filter on the other table cannot be expressed here
    const added = [...(filters.extra ?? []), ...derivedExtras(filters)];
    const own = added.filter((e) => e.entity === entity).map((e) => e.condition);
    const skipped = added.filter((e) => e.entity !== entity);
    if (skipped.length) toast.warning('Some filters were not carried over', `${skipped.map((e) => e.condition.field).join(', ')} ${skipped.length === 1 ? 'is a' : 'are'} ${entity === 'assets' ? 'finding' : 'asset'} field${skipped.length === 1 ? '' : 's'} and cannot be applied on the ${entity === 'assets' ? 'Assets' : 'Vulnerabilities'} page.`);
    open(entity, { ...base, children: [...base.children, ...own, ...extra] }, options);
  };

  const hygiene = (
    <WidgetCard ids={['coverage', 'toolVisibility', 'eolAssets']} title="Asset coverage & hygiene" subtitle="Agent coverage, tool visibility, staleness and OS support" className="lg:col-span-12">
      {(r) => {
        const c = r.coverage[0] ?? {};
        const total = num(c.total);
        const vis = r.toolVisibility.map((x) => ({ label: String(x.label), value: num(x.value) }));
        const visOrder = ['Full (3/3)', 'Partial (2/3)', 'Single (1/3)', 'None (0/3)'];
        const e = r.eolAssets[0] ?? {};
        return (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-1">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Agent &amp; staleness</div>
              <Meter label="Tenable agent installed" value={num(c.with_agent)} total={total} color="hsl(var(--ok))" onClick={() => drill('assets', lcond('te_has_agent', 'is true'))} />
              <Meter label="No Tenable agent" value={num(c.without_agent)} total={total} color="hsl(var(--sev-high))" onClick={() => drill('assets', lcond('te_has_agent', 'is false'))} />
              <Meter label="Agent status unknown" value={num(c.unknown_agent)} total={total} color="hsl(var(--muted-foreground) / 0.5)" onClick={() => drill('assets', lcond('te_has_agent', 'is empty'))} />
              <Meter label="Stale assets" value={num(c.stale)} total={total} color="hsl(var(--sev-critical))" onClick={() => drill('assets', lcond('asset_aging_status', 'is', semantics().values.staleStatus))} />
              <Meter label="Aging assets" value={num(c.aging)} total={total} color="hsl(var(--sev-medium))" onClick={() => drill('assets', lcond('asset_aging_status', 'is', semantics().values.agingStatus))} />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Tool visibility</div>
              <StackedBar
                segments={ordered(vis, visOrder).concat(vis.filter((v) => !visOrder.includes(v.label))).map((v) => ({ ...v, color: v.label.startsWith('Full') ? 'hsl(var(--ok))' : v.label.startsWith('Partial') ? 'hsl(var(--sev-medium))' : v.label.startsWith('Single') ? 'hsl(var(--sev-high))' : v.label.startsWith('None') ? 'hsl(var(--sev-critical))' : 'hsl(var(--muted-foreground) / 0.45)' }))}
                onSelect={(l) => drill('assets', eqOrUnknown('tool_visibility', l, visOrder))}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">OS support (assets with open findings)</div>
              <div className="grid grid-cols-2 gap-3">
                <button className="rounded-md border border-border p-3 text-left hover:bg-muted" onClick={() => drill('vulnerabilities', ...OPEN(), lcond('df_end_of_support_status', 'is', semantics().values.eos))}>
                  <div className="num text-2xl font-semibold text-sev-critical">{fmtNum(num(e.eos))}</div><div className="text-xs text-muted-foreground">End of support</div>
                </button>
                <button className="rounded-md border border-border p-3 text-left hover:bg-muted" onClick={() => drill('vulnerabilities', ...OPEN(), lcond('df_end_of_support_status', 'is', semantics().values.upcomingEos))}>
                  <div className="num text-2xl font-semibold text-sev-high">{fmtNum(num(e.upcoming))}</div><div className="text-xs text-muted-foreground">Upcoming EOS</div>
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Source: Defender end-of-support status on the vulnerabilities table (assets carry no EOL column).</p>
            </div>
          </div>
        );
      }}
    </WidgetCard>
  );

  return (
    <div className="mx-auto max-w-[1800px] space-y-5 p-4 sm:p-6">
      <Section title="Headline numbers">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard id="kpiTotalAssets" title="Total assets" pick={(r) => ({ value: num(r[0]?.value) })} series={s('unique_managed_assets')} goodWhen="neutral" onClick={() => drill('assets')} />
          <KpiCard id="kpiOpenVulns" title="Open vulns" pick={(r) => ({ value: num(r[0]?.value), sub: 'open findings, de-duplicated' })} onClick={() => drill('vulnerabilities', ...OPEN())} />
          <KpiCard id="kpiCritHigh" title="Critical + High" tone="critical" pick={(r) => ({ value: num(r[0]?.value), sub: 'by scanner severity' })} series={sumSeries(s('critical_risk_findings'), s('high_risk_findings'))} onClick={() => drill('vulnerabilities', ...OPEN(), CRIT_HIGH())} />
          <KpiCard id="kpiKev" title="Known exploited (KEV)" tone="critical" pick={(r) => ({ value: num(r[0]?.value), sub: 'open findings' })} series={s('known_exploited_vulnerabilities')} onClick={() => drill('vulnerabilities', ...OPEN(), lcond('kev_flag', 'is true'))} />
          <KpiCard id="kpiSla" title="SLA breach rate" tone="high" pick={(r) => { const t = num(r[0]?.total), b = num(r[0]?.breached); return { value: t ? (b / t) * 100 : 0, pct: true, sub: `${fmtNum(b)} of ${fmtNum(t)} open breached` }; }} series={s('findings_past_sla')} onClick={() => drill('vulnerabilities', ...OPEN(), lcond('sla_breached', 'is true'))} />
          <KpiCard id="kpiExposedCritHigh" title="Exposed, Crit/High" tone="high" pick={(r) => ({ value: num(r[0]?.value), sub: 'internet-facing, distinct assets' })} onClick={() => drill('vulnerabilities', ...OPEN(), CRIT_HIGH(), lcond('internet_exposed', 'is true'))} />
        </div>
      </Section>

      <ExecSections drill={drill} openConds={OPEN} />

      <Section title="Vulnerability distribution">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <WidgetCard ids={['severityDonut']} title="Vulnerabilities by severity" subtitle="Open findings">
            {(r) => {
              const rows = r.severityDonut.map((x) => ({ name: String(x.label), value: num(x.value) }));
              const data = SEVERITY_ORDER.map((n) => rows.find((x) => x.name === n)).filter(Boolean) as typeof rows;
              return <Donut data={data.concat(rows.filter((x) => !SEVERITY_ORDER.includes(x.name)))} onSelect={(n) => drill('vulnerabilities', ...OPEN(), eqOrUnknown('severity', n, SEVERITY_ORDER))} />;
            }}
          </WidgetCard>
          <WidgetCard ids={['slaStatus']} title="SLA status" subtitle="Open findings by SLA state">
            {(r) => {
              const order = ['Breached', 'Due Soon', 'Within SLA'];
              const rows = r.slaStatus.map((x) => ({ label: String(x.label), value: num(x.value) }));
              const all = ordered(rows, order).concat(rows.filter((x) => !order.includes(x.label)));
              return <StackedBar segments={all.map((x, i) => ({ ...x, color: colorFor(x.label, i) }))} onSelect={(l) => drill('vulnerabilities', ...OPEN(), eqOrUnknown('sla_status', l, order))} />;
            }}
          </WidgetCard>
          <WidgetCard ids={['overdueBuckets']} title="Overdue (days past SLA)" subtitle="Open findings past due">
            {(r) => (
              <BucketBars
                color="hsl(var(--sev-critical))"
                data={ordered(r.overdueBuckets.map((x) => ({ label: String(x.label), value: num(x.value) })), ['1-30', '31-60', '61-90', '90+'])}
                onSelect={(l) => { const [lo, hi] = BUCKETS[l] ?? [0, 0]; drill('vulnerabilities', ...OPEN(), hi === null ? lcond('overdue_days', '≥', lo) : lcond('overdue_days', 'between', [lo, hi])); }}
              />
            )}
          </WidgetCard>
          <WidgetCard ids={['ageBuckets']} title="Vulnerability age" subtitle="Days since first found (open)">
            {(r) => (
              <BucketBars
                data={ordered(r.ageBuckets.map((x) => ({ label: String(x.label), value: num(x.value) })), ['0-30', '31-60', '61-90', '91-180', '180+', 'Unknown']).filter((d) => d.label !== 'Unknown' || d.value > 0)}
                onSelect={(l) => { if (l === 'Unknown') return drill('vulnerabilities', ...OPEN(), lcond('vulnerability_age_days', 'is empty')); const [lo, hi] = BUCKETS[l]; drill('vulnerabilities', ...OPEN(), hi === null ? lcond('vulnerability_age_days', '≥', lo) : lcond('vulnerability_age_days', 'between', [lo, hi])); }}
              />
            )}
          </WidgetCard>
        </div>
      </Section>

      <Section title="Top 10">
        <div className="grid gap-3 lg:grid-cols-3">
          <WidgetCard ids={['topAssets']} title="Top 10 riskiest assets" subtitle="Ranked by total final score of open findings">
            {(r) => (
              <TopTable
                rows={r.topAssets}
                onRow={(x) => drill('vulnerabilities', ...OPEN(), lcond('gold_asset_id', 'is', String(x.gold_asset_id)))}
                columns={[
                  { key: 'hostname', label: 'Host', mono: true },
                  { key: 'criticality', label: 'Criticality', render: (x) => <CritBadge value={x.criticality} /> },
                  { key: 'vulns', label: 'Vulns', align: 'right' },
                  { key: 'kev', label: 'KEV', align: 'right' },
                  { key: 'max_score', label: 'Max', align: 'right', render: (x) => fmtNum(num(x.max_score), 1) },
                ]}
              />
            )}
          </WidgetCard>
          <WidgetCard ids={['topVulns']} title="Top 10 vulnerabilities" subtitle="By number of affected assets">
            {(r) => (
              <TopTable
                rows={r.topVulns}
                onRow={(x) => drill('vulnerabilities', ...OPEN(), lcond('vulnerability_name', 'is', String(x.vulnerability_name)))}
                columns={[
                  { key: 'vulnerability_name', label: 'Vulnerability', className: 'max-w-[11rem]' },
                  { key: 'cve', label: 'CVE', mono: true },
                  { key: 'assets', label: 'Assets', align: 'right' },
                  { key: 'findings', label: 'Findings', align: 'right' },
                ]}
              />
            )}
          </WidgetCard>
          <WidgetCard ids={['topSoftware']} title="Top 10 vulnerable software" subtitle="By open findings, with the recommended fix">
            {(r) => (
              <TopTable
                rows={r.topSoftware}
                onRow={(x) => drill('vulnerabilities', ...OPEN(), lcond('software_name', 'is', String(x.software_name)))}
                columns={[
                  { key: 'software_name', label: 'Software', className: 'max-w-[9rem]' },
                  { key: 'recommended_version', label: 'Recommended', className: 'max-w-[9rem]' },
                  { key: 'assets', label: 'Assets', align: 'right' },
                  { key: 'vulns', label: 'Vulns', align: 'right' },
                ]}
              />
            )}
          </WidgetCard>
        </div>
      </Section>

      <Section title="Business unit and region">
        <div className="grid gap-3 xl:grid-cols-2">
          <BreakdownCard title="By business unit" groupLabel="Business unit" subtitle="Assets and open findings per business unit · click a row for the records" assetsId="assetsByBusinessUnit" findingsId="findingsByBusinessUnit"
            onRow={(label, known) => drill('vulnerabilities', ...OPEN(), eqOrUnknown('business_unit', label, known))} />
          <BreakdownCard title="By region" groupLabel="Region" subtitle="Assets and open findings per region · click a row for the records" assetsId="assetsByRegion" findingsId="findingsByRegion"
            onRow={(label, known) => drill('vulnerabilities', ...OPEN(), eqOrUnknown('region', label, known))} />
        </div>
      </Section>

      <Section title="Risk and inventory">
        <div className="grid gap-3 lg:grid-cols-12">
          <WidgetCard ids={['riskByBusinessUnit']} title="Risk by business unit" subtitle="Open findings stacked by severity" className="lg:col-span-6">
            {(r) => <SeverityStack rows={r.riskByBusinessUnit} groupKey="business_unit" onSelect={(bu, sev) => drill('vulnerabilities', ...OPEN(), lcond('business_unit', 'is', bu), lcond('severity', 'is', sev))} />}
          </WidgetCard>
          <WidgetCard ids={['assetsByCriticality', 'assetsByClass']} title="Asset inventory" subtitle="By criticality and by asset class" className="lg:col-span-6">
            {(r) => {
              const crit = ['Critical', 'High', 'Medium', 'Low'];
              const a = r.assetsByCriticality.map((x) => ({ name: String(x.label), value: num(x.value) }));
              const byCrit = (crit.map((n) => a.find((x) => x.name === n)).filter(Boolean) as typeof a).concat(a.filter((x) => !crit.includes(x.name)));
              const byClass = r.assetsByClass.map((x, i) => ({ name: String(x.label), value: num(x.value), i }));
              return (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><div className="mb-2 text-xs font-medium text-muted-foreground">By criticality</div><Donut data={byCrit} onSelect={(n) => drill('assets', eqOrUnknown('criticality', n, crit))} /></div>
                  <div><div className="mb-2 text-xs font-medium text-muted-foreground">By asset class</div><Donut data={byClass} onSelect={(n) => drill('assets', eqOrUnknown('asset_class', n, byClass.map((x) => x.name).filter((x) => !x.startsWith('Unknown'))))} /></div>
                </div>
              );
            }}
          </WidgetCard>
          {hygiene}
        </div>
      </Section>

      <TrendsRow />
    </div>
  );
}

export function OverviewPage() {
  const [sp, setSp] = useSearchParams();
  const { filters, options } = useFilters();
  const qc = useQueryClient();
  const refreshed = useRefreshed();
  const busy = useIsFetching({ queryKey: ['widgets'] }) + useIsFetching({ queryKey: ['kpis'] });
  const [stamp, setStamp] = useState(() => new Date());

  // Hydrate filters from the URL once, before the first paint of the widgets.
  useState(() => {
    if (sp.toString()) {
      const parsed = searchToFilters(sp);
      useFilters.setState({ filters: parsed.filters, options: parsed.options });
    }
    return null;
  });
  useEffect(() => {
    const next = filtersToSearch(filters, options);
    if (next.toString() !== sp.toString()) setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, options]);

  const latest = useMemo(() => [refreshed.data?.assets, refreshed.data?.vulnerabilities].filter(Boolean).sort().pop(), [refreshed.data]);
  const refresh = () => {
    // Manual refresh asks the server to bypass its short result cache; automatic loads use the cache (saves warehouse time).
    freshFlag.on = true;
    void Promise.all(['widgets', 'kpis', 'refreshed', 'total', 'summary', 'data-check'].map((k) => qc.invalidateQueries({ queryKey: [k] }))).finally(() => (freshFlag.on = false));
    setStamp(new Date());
  };

  return (
    <OverviewDataProvider>
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-[34px] leading-none">Security overview</h1>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity size={12} /> Data as of <span className="mono">{latest ? String(latest).slice(0, 10) : '…'}</span> · fetched {stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div className="no-print flex items-center gap-2">
            <Button size="sm" onClick={refresh} aria-label="Refresh all widgets"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh</Button>
            <Button size="sm" onClick={() => window.print()} aria-label="Print or save as PDF"><Printer size={14} /> PDF</Button>
          </div>
        </div>
      </div>
      <GlobalFilterBar />
      <DataCheckBanner />
      <PageBody />
    </OverviewDataProvider>
  );
}
