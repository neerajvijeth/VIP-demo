import type { Condition, Entity, FieldDef, MetricFn, SummaryMetric, SummarySpec } from '@shared/types';
import { cond } from './tree';
import { L } from '@shared/semantics';

export const metricPresets = (e: Entity): SummaryMetric[] =>
  e === 'assets'
    ? [{ fn: 'count_distinct', field: L('gold_asset_id') }, { fn: 'count' }]
    : [{ fn: 'count_distinct', field: L('finding_id') }, { fn: 'count_distinct', field: L('gold_asset_id') }, { fn: 'count' }];

export const FN_CHOICES: { fn: MetricFn; label: string; accepts: (f: FieldDef) => boolean }[] = [
  { fn: 'sum', label: 'Total of', accepts: (f) => f.type === 'number' },
  { fn: 'avg', label: 'Average of', accepts: (f) => f.type === 'number' },
  { fn: 'max', label: 'Highest', accepts: (f) => f.type === 'number' || f.type === 'date' },
  { fn: 'min', label: 'Lowest', accepts: (f) => f.type === 'number' || f.type === 'date' },
  { fn: 'count_distinct', label: 'Distinct count of', accepts: () => true },
];

const sameMetric = (a: SummaryMetric, b: SummaryMetric) => a.fn === b.fn && (a.field ?? '') === (b.field ?? '');
export const hasMetric = (s: SummarySpec, m: SummaryMetric) => s.metrics.some((x) => sameMetric(x, m));

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const endOfMonth = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

/** Filter conditions that reproduce one summary row (used to drill from a group to its rows). */
export function drillConditions(spec: SummarySpec, row: Record<string, any>, fields: Map<string, FieldDef>): Condition[] {
  return spec.groupBy.map((g, i) => {
    const v = String(row[`group_${i + 1}`] ?? '');
    const f = fields.get(g.field);
    if (v === '(empty)' || v === '') return cond(g.field, 'is empty');
    switch (f?.type) {
      case 'boolean': return cond(g.field, v === 'true' ? 'is true' : 'is false');
      case 'number': return cond(g.field, '=', Number(v));
      case 'date':
        if (g.bucket === 'month') return cond(g.field, 'between', [v, endOfMonth(v)]);
        if (g.bucket === 'week') return cond(g.field, 'between', [v, addDays(v, 6)]);
        return cond(g.field, 'on', v);
      default: return cond(g.field, 'is', v);
    }
  });
}
