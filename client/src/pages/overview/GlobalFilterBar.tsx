import { FilterX, Info } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { GlobalFilters } from '@shared/types';
import { countActiveFilters } from '@shared/filters';
import { Button, Segmented, Switch } from '@/components/ui/primitives';
import { ValuePicker } from '@/components/ui/pickers';
import { Api } from '@/lib/api';
import { useFilters } from '@/store/filters';
import { L } from '@shared/semantics';
import { ExtraFilters } from './ExtraFilters';
import { NotAppliedPill, useActiveFilters } from './NotApplied';

const FILTERS: { key: 'business_unit' | 'region' | 'country' | 'criticality' | 'asset_class' | 'device_type'; label: string }[] = [
  { key: 'business_unit', label: 'Business unit' },
  { key: 'region', label: 'Region' },
  { key: 'country', label: 'Country' },
  { key: 'criticality', label: 'Criticality' },
  { key: 'asset_class', label: 'Asset class' },
  { key: 'device_type', label: 'Device type' },
];

export function GlobalFilterBar() {
  const { filters, options, patch, clear, setOptions } = useFilters();
  const fa = useQuery({ queryKey: ['fields', 'assets'], queryFn: () => Api.fields('assets'), staleTime: Infinity });
  const fv = useQuery({ queryKey: ['fields', 'vulnerabilities'], queryFn: () => Api.fields('vulnerabilities'), staleTime: Infinity });
  const noSnapshot = !!fa.data && !!fv.data && !fa.data.scope.snapshot && !fv.data.scope.snapshot;
  const active = countActiveFilters(filters);
  const activeList = useActiveFilters();
  return (
    <div className="no-print sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm sm:px-6">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <ValuePicker
            key={f.key}
            multi
            label={f.label}
            placeholder={f.label}
            value={filters[f.key]}
            onChange={(v) => patch({ [f.key]: v } as Partial<GlobalFilters>)}
            load={(q) => Api.values('assets', L(f.key), q)}
            cacheKey={`assets:${L(f.key)}`}
            className="w-[10.5rem]"
          />
        ))}
        <ValuePicker multi label="VOC priority" placeholder="VOC priority" value={filters.priority ?? []} onChange={(v) => patch({ priority: v })} load={(q) => Api.values('vulnerabilities', L('priority_code'), q)} cacheKey={`vulnerabilities:${L('priority_code')}`} className="w-[10.5rem]" />
        <ValuePicker multi label="OS family" placeholder="OS family" value={filters.os_family ?? []} onChange={(v) => patch({ os_family: v })} load={(q) => Api.values('assets', L('os_type'), q)} cacheKey={`assets:${L('os_type')}`} className="w-[10.5rem]" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">KEV</span>
          <Segmented size="sm" ariaLabel="Known exploited" value={filters.kev ?? 'all'} onChange={(v) => patch({ kev: v })} options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Internet exposed</span>
          <Segmented
            size="sm"
            ariaLabel="Internet exposed"
            value={filters.internet_exposed}
            onChange={(v) => patch({ internet_exposed: v })}
            options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          />
        </div>
        <ExtraFilters />
        <Button variant="ghost" size="sm" onClick={clear} disabled={!active} aria-label="Clear all filters">
          <FilterX size={14} /> Clear all{active ? ` (${active})` : ''}
        </Button>
        <div className="ml-auto flex items-center gap-4">
          <Switch disabled={noSnapshot} checked={options.latestSnapshotOnly} onChange={(b) => setOptions({ latestSnapshotOnly: b })} label="Latest snapshot only" />
        </div>
      </div>
      <p className="mx-auto mt-1.5 flex max-w-[1800px] flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <Info size={12} /> Filters apply to every card. A filter on a column of the other table links through the asset ID.
        <NotAppliedPill items={activeList} reason="Trends come from the KPI metrics table, which has no per-asset columns, so it always shows the whole estate." className="ml-1" />
        {activeList.length > 0 && <span className="text-muted-foreground">on Trends</span>}
      </p>
    </div>
  );
}
