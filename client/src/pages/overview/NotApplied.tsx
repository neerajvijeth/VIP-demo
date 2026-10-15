import { useMemo } from 'react';
import { FilterX } from 'lucide-react';
import type { Condition, Entity, GlobalFilters } from '@shared/types';
import { NO_VALUE_OPS } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';
import { useFilters } from '@/store/filters';
import { useFilterFields } from './ExtraFilters';

export interface ActiveFilter { id: string; label: string; text: string; entity?: Entity }

const FIXED: Array<[keyof GlobalFilters, string]> = [['business_unit', 'Business unit'], ['region', 'Region'], ['country', 'Country'], ['criticality', 'Criticality'], ['asset_class', 'Asset class'], ['device_type', 'Device type']];
const valueText = (c: Condition) => {
  const v = c.value;
  const vals = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  const shown = vals.length > 2 ? `${vals.slice(0, 2).join(', ')} +${vals.length - 2}` : vals.join(c.operator === 'between' ? ' – ' : ', ');
  return NO_VALUE_OPS.has(c.operator) ? c.operator : `${c.operator} ${shown}`;
};

/** Every filter currently narrowing the dashboard (fixed ones and the ones you added), in plain words. */
export function useActiveFilters(): ActiveFilter[] {
  const { filters } = useFilters();
  const { fields } = useFilterFields();
  return useMemo(() => {
    const out: ActiveFilter[] = [];
    for (const [k, label] of FIXED) { const v = filters[k] as string[]; if (v?.length) out.push({ id: k, label, text: v.length > 2 ? `${v.slice(0, 2).join(', ')} +${v.length - 2}` : v.join(', ') }); }
    if (filters.priority?.length) out.push({ id: 'priority', label: 'VOC priority', text: filters.priority.join(', ') });
    if (filters.os_family?.length) out.push({ id: 'os_family', label: 'OS family', text: filters.os_family.join(', ') });
    if (filters.kev && filters.kev !== 'all') out.push({ id: 'kev', label: 'KEV', text: filters.kev === 'yes' ? 'Yes' : 'No' });
    if (filters.internet_exposed !== 'all') out.push({ id: 'internet_exposed', label: 'Internet exposed', text: filters.internet_exposed === 'yes' ? 'Yes' : 'No' });
    for (const e of filters.extra ?? []) out.push({ id: e.id, label: fields.find((f) => f.entity === e.entity && f.key === e.condition.field)?.label ?? e.condition.field, text: valueText(e.condition), entity: e.entity });
    return out;
  }, [filters, fields]);
}

/** Small amber pill (with a popover that explains why) for a card that cannot honour some of the active filters. */
export function NotAppliedPill({ items, reason, className }: { items: ActiveFilter[]; reason: string; className?: string }) {
  if (!items.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn('no-print inline-flex items-center gap-1 rounded-full border border-sev-medium/40 bg-sev-medium/10 px-2 py-0.5 text-[11px] font-medium text-sev-medium hover:bg-sev-medium/15', className)} aria-label={`${items.length} filter${items.length === 1 ? '' : 's'} not applied to this card`}>
          <FilterX size={11} /> {items.length} filter{items.length === 1 ? '' : 's'} not applied
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 text-xs">
        <div className="mb-1 font-medium">Not applied to this card</div>
        <p className="mb-2 text-muted-foreground">{reason}</p>
        <ul className="space-y-1">{items.map((f) => <li key={f.id} className="rounded bg-muted px-2 py-1"><span className="text-muted-foreground">{f.label} </span><b className="font-medium">{f.text}</b></li>)}</ul>
      </PopoverContent>
    </Popover>
  );
}

/** Banner for a whole section that ignores the filters (Trends). Hidden when nothing is filtered. */
export function NotAppliedBanner({ reason }: { reason: string }) {
  const items = useActiveFilters();
  if (!items.length) return null;
  return (
    <div role="note" className="mb-3 flex flex-wrap items-start gap-3 rounded-lg border border-sev-medium/30 bg-sev-medium/10 px-3 py-2.5 text-xs">
      <FilterX size={15} className="mt-0.5 shrink-0 text-sev-medium" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{items.length === 1 ? 'Your filter is' : `Your ${items.length} filters are`} not applied here</div>
        <p className="mt-0.5 text-muted-foreground">{reason}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">{items.map((f) => <span key={f.id} className="rounded border border-border bg-card px-1.5 py-0.5"><span className="text-muted-foreground">{f.label} </span><b className="font-medium">{f.text}</b></span>)}</div>
      </div>
    </div>
  );
}
