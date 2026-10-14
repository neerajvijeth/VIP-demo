import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { Entity } from '@shared/types';
import { Sheet } from '@/components/ui/overlay';
import { Button, ErrorPanel, Input, Skeleton } from '@/components/ui/primitives';
import { Api } from '@/lib/api';
import { ENTITY } from '@/lib/entities';
import { useOpenBuilder } from '@/lib/hooks';
import { builderStore } from '@/store/builder';
import { lcond } from '@/lib/sem';
import { L } from '@shared/semantics';
import { emptyGroup } from '@shared/types';
import { fmtDate } from './cells';

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function DetailDrawer({ entity }: { entity: Entity }) {
  const s = builderStore(entity);
  const detail = s((x) => x.detail);
  const setDetail = s((x) => x.setDetail);
  const open = useOpenBuilder();
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const q = useQuery({ queryKey: ['detail', entity, detail?.key, detail?.snapshot], queryFn: () => Api.detail(entity, detail!.key, detail!.snapshot), enabled: !!detail, staleTime: 5 * 60_000, retry: 0 });

  const entries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return Object.entries(q.data?.row ?? {})
      .filter(([k, v]) => !needle || k.includes(needle) || show(v).toLowerCase().includes(needle))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [q.data, filter]);

  const assetId = q.data?.row?.[L('gold_asset_id')] ? String(q.data.row[L('gold_asset_id')]) : null;
  const goAsset = (target: Entity) => {
    setDetail(null);
    open(target, { ...emptyGroup(), children: [lcond('gold_asset_id', 'is', assetId!)] });
  };

  return (
    <Sheet
      open={!!detail}
      onOpenChange={(o) => !o && setDetail(null)}
      title={<span className="mono">{detail?.key}</span>}
      description={`${ENTITY[entity].label.replace(/ies$/, 'y').replace(/s$/, '')} details · all columns of this row`}
      width="max-w-2xl"
    >
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Filter fields…" aria-label="Filter fields" className="h-8 flex-1" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(q.data?.row ?? {}, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); }} disabled={!q.data}>
            {copied ? <Check size={14} /> : <Copy size={14} />} Copy JSON
          </Button>
          {entity === 'vulnerabilities' && assetId && <Button size="sm" variant="primary" onClick={() => goAsset('assets')}><ExternalLink size={14} /> Open asset in Assets page</Button>}
          {entity === 'assets' && assetId && <Button size="sm" onClick={() => goAsset('vulnerabilities')}><ExternalLink size={14} /> Vulnerabilities on this asset</Button>}
        </div>
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : q.isError ? (
          <ErrorPanel message={(q.error as Error).message} onRetry={() => void q.refetch()} />
        ) : (
          <dl className="divide-y divide-border/60 rounded-md border border-border">
            {entries.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[minmax(8rem,38%)_1fr] gap-3 px-3 py-1.5 text-sm">
                <dt className="mono truncate text-xs text-muted-foreground" title={k}>{k}</dt>
                <dd className="mono min-w-0 break-words text-xs">{show(v) ? (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtDate(v) : show(v)) : <span className="text-muted-foreground/50">–</span>}</dd>
              </div>
            ))}
            {entries.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">No fields match.</div>}
          </dl>
        )}
      </div>
    </Sheet>
  );
}
