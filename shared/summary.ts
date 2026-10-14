import type { SummaryGroup, SummaryMetric, SummarySpec } from './types';
import { L } from './semantics';

/** Friendly metric names, shared by the server (CSV headers) and the client (UI). */
export function metricLabel(m: SummaryMetric, labelOf: (key: string) => string): string {
  const f = m.field ? labelOf(m.field) : '';
  switch (m.fn) {
    case 'count': return 'Records';
    case 'count_distinct':
      if (m.field === L('gold_asset_id')) return 'Assets';
      if (m.field === L('finding_id')) return 'Findings';
      if (m.field === L('hostname')) return 'Hosts';
      return `Distinct ${f}`;
    case 'sum': return `Total ${f}`;
    case 'avg': return `Average ${f}`;
    case 'min': return `Lowest ${f}`;
    case 'max': return `Highest ${f}`;
  }
}
export const groupLabel = (g: SummaryGroup, labelOf: (key: string) => string) => labelOf(g.field) + (g.bucket ? ` (by ${g.bucket})` : '');
export const summaryColumns = (s: SummarySpec) => [...s.groupBy.map((_, i) => `group_${i + 1}`), ...s.metrics.map((_, i) => `metric_${i + 1}`)];
export const summaryLabels = (s: SummarySpec, labelOf: (key: string) => string) => [...s.groupBy.map((g) => groupLabel(g, labelOf)), ...s.metrics.map((m) => metricLabel(m, labelOf))];
