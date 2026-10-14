import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { DateBucket, Entity, FieldDef, SummaryMetric, SummarySpec } from '@shared/types';
import { SUMMARY_LIMITS } from '@shared/types';
import { groupLabel, metricLabel } from '@shared/summary';
import { Button, NativeSelect } from '@/components/ui/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import { FieldPicker } from '@/components/ui/pickers';
import { FN_CHOICES, metricPresets, hasMetric } from '@/lib/summary';

const LIMITS = [10, 25, 50, 100, 250, 1000];
const chip = 'inline-flex items-center gap-1.5 rounded-sm bg-muted px-2 py-1 text-xs';

/** "Show [values] for each [groups]" — the whole GROUP BY setup in three short lines. */
export function SummaryEditor({ entity, fields, spec, onChange }: { entity: Entity; fields: FieldDef[]; spec: SummarySpec; onChange: (s: SummarySpec) => void }) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const labelOf = (k: string) => byKey.get(k)?.label ?? k;
  const [fnPick, setFnPick] = useState(FN_CHOICES[0].fn);
  const [open, setOpen] = useState(false);
  const fn = FN_CHOICES.find((c) => c.fn === fnPick)!;

  const addMetric = (m: SummaryMetric) => {
    if (spec.metrics.length >= SUMMARY_LIMITS.maxMetrics || hasMetric(spec, m)) return;
    onChange({ ...spec, metrics: [...spec.metrics, m] });
    setOpen(false);
  };
  const setMetrics = (metrics: SummaryMetric[]) => onChange({ ...spec, metrics, sort: null });
  const setGroups = (groupBy: SummarySpec['groupBy']) => onChange({ ...spec, groupBy, sort: null });

  const sortOptions = [
    ...spec.metrics.map((m, i) => ({ v: `metric_${i + 1}`, label: metricLabel(m, labelOf) })),
    ...spec.groupBy.map((g, i) => ({ v: `group_${i + 1}`, label: groupLabel(g, labelOf) })),
  ];
  const sortValue = spec.sort ? `${spec.sort.by}:${spec.sort.dir}` : 'metric_1:desc';

  return (
    <div className="space-y-3" aria-label="Summary setup">
      <div className="grid items-start gap-2 sm:grid-cols-[5.5rem_1fr]">
        <span className="eyebrow pt-1.5">Show</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {spec.metrics.map((m, i) => (
            <span key={i} className={chip}>
              {metricLabel(m, labelOf)}
              <button className="text-muted-foreground hover:text-sev-critical disabled:opacity-30" disabled={spec.metrics.length <= 1} onClick={() => setMetrics(spec.metrics.filter((_, j) => j !== i))} aria-label={`Remove ${metricLabel(m, labelOf)}`}><X size={11} /></button>
            </span>
          ))}
          {spec.metrics.length < SUMMARY_LIMITS.maxMetrics && (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild><Button size="sm" className="border-dashed"><Plus size={13} /> Add value</Button></PopoverTrigger>
              <PopoverContent className="w-80 p-3">
                <div className="eyebrow mb-1.5">Quick</div>
                <div className="flex flex-wrap gap-1.5">
                  {metricPresets(entity).map((m, i) => (
                    <button key={i} disabled={hasMetric(spec, m)} onClick={() => addMetric(m)} className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40">{metricLabel(m, labelOf)}</button>
                  ))}
                </div>
                <div className="eyebrow mb-1.5 mt-3">Calculate on a field</div>
                <div className="flex items-center gap-1.5">
                  <NativeSelect className="h-9" value={fnPick} onChange={(e) => setFnPick(e.target.value as typeof fnPick)} aria-label="Calculation">
                    {FN_CHOICES.map((c) => <option key={c.fn} value={c.fn}>{c.label}</option>)}
                  </NativeSelect>
                  <FieldPicker fields={fields.filter(fn.accepts)} onSelect={(f) => addMetric({ fn: fn.fn, field: f.key })} ariaLabel="Field to calculate on" triggerClassName="flex-1">
                    <span className="truncate text-muted-foreground">Pick a field…</span>
                  </FieldPicker>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        <span className="eyebrow pt-1.5">For each</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {spec.groupBy.map((g, i) => {
            const f = byKey.get(g.field);
            return (
              <span key={g.field} className={chip}>
                {f?.label ?? g.field}
                {f?.type === 'date' && (
                  <NativeSelect className="h-6 border-0 bg-transparent px-1 text-xs" value={g.bucket ?? 'day'} aria-label="Group dates by" onChange={(e) => setGroups(spec.groupBy.map((x, j) => (j === i ? { ...x, bucket: e.target.value as DateBucket } : x)))}>
                    <option value="day">by day</option><option value="week">by week</option><option value="month">by month</option>
                  </NativeSelect>
                )}
                <button className="text-muted-foreground hover:text-sev-critical disabled:opacity-30" disabled={spec.groupBy.length <= 1} onClick={() => setGroups(spec.groupBy.filter((_, j) => j !== i))} aria-label={`Remove ${f?.label ?? g.field}`}><X size={11} /></button>
              </span>
            );
          })}
          {spec.groupBy.length < SUMMARY_LIMITS.maxGroups && (
            <FieldPicker
              fields={fields.filter((f) => !spec.groupBy.some((g) => g.field === f.key))}
              onSelect={(f) => setGroups([...spec.groupBy, { field: f.key, bucket: f.type === 'date' ? 'month' : undefined }])}
              ariaLabel={spec.groupBy.length ? 'Add a second grouping' : 'Add grouping'}
              triggerClassName="min-w-0 border-dashed h-8 text-xs"
            >
              <Plus size={13} /> {spec.groupBy.length ? 'Then by' : 'Add grouping'}
            </FieldPicker>
          )}
        </div>

        <span className="eyebrow pt-2">Order</span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <NativeSelect className="h-8 text-xs" aria-label="Sort by" value={sortValue} onChange={(e) => { const [by, dir] = e.target.value.split(':'); onChange({ ...spec, sort: { by, dir: dir as 'asc' | 'desc' } }); }}>
            {sortOptions.flatMap((o) => [
              <option key={`${o.v}:desc`} value={`${o.v}:desc`}>{o.label} · high to low</option>,
              <option key={`${o.v}:asc`} value={`${o.v}:asc`}>{o.label} · low to high</option>,
            ])}
          </NativeSelect>
          show top
          <NativeSelect className="h-8 text-xs" aria-label="Number of groups" value={spec.limit} onChange={(e) => onChange({ ...spec, limit: Number(e.target.value) })}>
            {LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}
          </NativeSelect>
          groups
        </div>
      </div>
    </div>
  );
}
