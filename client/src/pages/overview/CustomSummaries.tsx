import { useMemo, useState } from 'react';
import { ExternalLink, Pencil, Plus, X } from 'lucide-react';
import type { Group } from '@shared/types';
import { emptySummary } from '@shared/types';
import { filtersToTree } from '@shared/filters';
import { groupLabel, metricLabel } from '@shared/summary';
import { Button, Card, Segmented, Switch } from '@/components/ui/primitives';
import { SummaryEditor } from '@/components/summary/SummaryEditor';
import { SummaryResult } from '@/components/summary/SummaryResult';
import { useFields, useOpenBuilder } from '@/lib/hooks';
import { drillConditions } from '@/lib/summary';
import { openCond } from '@/lib/sem';
import { useFilters } from '@/store/filters';
import { useSummaries, type SummaryCardCfg } from '@/store/summaries';
import type { SummaryRequest } from '@/lib/api';

function SummaryCard({ cfg }: { cfg: SummaryCardCfg }) {
  const { update, remove } = useSummaries();
  const { filters, options } = useFilters();
  const open = useOpenBuilder();
  const { fields, map } = useFields(cfg.entity);
  const [editing, setEditing] = useState(false);
  const labelOf = (k: string) => map.get(k)?.label ?? k;

  const tree = useMemo<Group>(() => {
    const base = filtersToTree(filters);
    const own = (filters.extra ?? []).filter((e) => e.entity === cfg.entity).map((e) => e.condition); // filters you added on this card's own table
    const withOwn = { ...base, children: [...base.children, ...own] };
    return cfg.entity === 'vulnerabilities' && cfg.openOnly ? { ...withOwn, children: [...withOwn.children, openCond()] } : withOwn;
  }, [filters, cfg.entity, cfg.openOnly]);
  // a filter on the other table cannot be expressed in this single-table summary
  const skipped = (filters.extra ?? []).filter((e) => e.entity !== cfg.entity);
  const req: SummaryRequest | null = map.size ? { mode: 'summary', entity: cfg.entity, tree, options, summary: cfg.spec } : null;
  const title = `${metricLabel(cfg.spec.metrics[0], labelOf)} per ${cfg.spec.groupBy.map((g) => groupLabel(g, labelOf)).join(' and ')}`;

  const drill = (row?: Record<string, any>) => {
    const extra = row ? drillConditions(cfg.spec, row, map) : [];
    open(cfg.entity, { ...tree, children: [...tree.children, ...extra] }, options, row ? null : cfg.spec);
  };
  const onSort = (by: string) => {
    const cur = cfg.spec.sort ?? { by: 'metric_1', dir: 'desc' as const };
    update(cfg.id, { spec: { ...cfg.spec, sort: { by, dir: cur.by === by && cur.dir === 'desc' ? 'asc' : cur.by === by ? 'desc' : by.startsWith('metric') ? 'desc' : 'asc' } } });
  };

  return (
    <Card className="min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[22px] leading-6" title={title}>{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">From {cfg.entity === 'assets' ? 'assets' : 'vulnerabilities'} · uses the filters above
            {skipped.length > 0 && <span className="text-sev-medium" title={skipped.map((e) => e.condition.field).join(', ')}> · {skipped.length} filter{skipped.length === 1 ? '' : 's'} on {cfg.entity === 'assets' ? 'finding' : 'asset'} fields not applied here</span>}</p>
        </div>
        <div className="no-print flex items-center gap-1">
          <Button size="sm" variant={editing ? 'secondary' : 'ghost'} onClick={() => setEditing((e) => !e)} aria-pressed={editing}><Pencil size={13} /> {editing ? 'Done' : 'Edit'}</Button>
          <Button size="sm" variant="ghost" onClick={() => drill()} title="Open this summary in the query builder"><ExternalLink size={13} /> Builder</Button>
          <Button size="iconSm" variant="ghost" onClick={() => remove(cfg.id)} aria-label="Remove this summary"><X size={14} /></Button>
        </div>
      </div>

      {editing && (
        <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="eyebrow">Data</span>
            <Segmented size="sm" ariaLabel="Data source" value={cfg.entity} onChange={(entity) => update(cfg.id, { entity, spec: emptySummary(entity) })} options={[{ value: 'assets', label: 'Assets' }, { value: 'vulnerabilities', label: 'Vulnerabilities' }]} />
            {cfg.entity === 'vulnerabilities' && <Switch checked={cfg.openOnly} onChange={(openOnly) => update(cfg.id, { openOnly })} label="Open findings only" />}
          </div>
          <SummaryEditor entity={cfg.entity} fields={fields} spec={cfg.spec} onChange={(spec) => update(cfg.id, { spec })} />
        </div>
      )}

      <SummaryResult req={req} spec={cfg.spec} onSort={onSort} onDrill={drill} fieldMap={map} />
    </Card>
  );
}

export function CustomSummaries() {
  const { cards, add } = useSummaries();
  return (
    <section aria-labelledby="custom-h">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="custom-h" className="font-display text-[26px] leading-none">Ask your own question</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">Count or total anything by any field, for example assets per business unit. Respects the filters above. Click a row to see the records.</p>
        </div>
        <Button size="sm" className="no-print" onClick={add} disabled={cards.length >= 6}><Plus size={14} /> Add summary</Button>
      </div>
      {cards.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No summaries yet. Use “Add summary” to create one.</Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">{cards.map((c) => <SummaryCard key={c.id} cfg={c} />)}</div>
      )}
    </section>
  );
}
