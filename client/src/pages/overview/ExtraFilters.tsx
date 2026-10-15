import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import type { Entity, ExtraFilter, FieldDef } from '@shared/types';
import { NO_VALUE_OPS, OPERATORS } from '@shared/types';
import { Button, NativeSelect } from '@/components/ui/primitives';
import { FieldPicker } from '@/components/ui/pickers';
import { Modal } from '@/components/ui/overlay';
import { ValueInput } from '@/pages/builder/ValueInput';
import { Api } from '@/lib/api';
import { uid } from '@/lib/utils';
import { toast } from '@/store/toast';
import { useFilters } from '@/store/filters';

type Pick = FieldDef & { entity: Entity };
const JUNK = /hash|file_path|file_size|rescued|etl_tm|^#/i;
const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && (v.length === 0 || v.some((x) => x === '' || x === null)));

/** Fields from BOTH tables. A column that exists on both is offered once (as the asset's), because the asset row is the source of truth. */
export function useFilterFields(): { fields: Pick[]; loading: boolean; error: boolean } {
  const fa = useQuery({ queryKey: ['fields', 'assets'], queryFn: () => Api.fields('assets'), staleTime: Infinity });
  const fv = useQuery({ queryKey: ['fields', 'vulnerabilities'], queryFn: () => Api.fields('vulnerabilities'), staleTime: Infinity });
  const fields = useMemo(() => {
    const a = (fa.data?.fields ?? []).filter((f) => !JUNK.test(f.key));
    const aKeys = new Set(a.map((f) => f.key));
    return [
      ...a.map((f) => ({ ...f, entity: 'assets' as const, group: `Asset · ${f.group}` })),
      ...(fv.data?.fields ?? []).filter((f) => !JUNK.test(f.key) && !aKeys.has(f.key)).map((f) => ({ ...f, entity: 'vulnerabilities' as const, group: `Finding · ${f.group}` })),
    ];
  }, [fa.data, fv.data]);
  return { fields, loading: fa.isLoading || fv.isLoading, error: fa.isError || fv.isError };
}

const summary = (f: ExtraFilter) => {
  const { operator: op, value: v } = f.condition;
  const vals = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  const shown = vals.length > 2 ? `${vals.slice(0, 2).join(', ')} +${vals.length - 2}` : vals.join(vals.length === 2 && op === 'between' ? ' – ' : ', ');
  return NO_VALUE_OPS.has(op) ? op : `${op} ${shown}`;
};

interface Draft { id?: string; entity: Entity; field: Pick; operator: string; value: any }

function Editor({ draft, onChange, onApply, onCancel }: { draft: Draft; onChange: (d: Draft) => void; onApply: () => void; onCancel: () => void }) {
  const ops = draft.field.operators?.length ? draft.field.operators : OPERATORS[draft.field.type];
  const ok = NO_VALUE_OPS.has(draft.operator) || !empty(draft.value);
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">{draft.field.label}</div>
        <div className="text-[11px] text-muted-foreground">{draft.entity === 'assets' ? 'Asset field: also narrows the finding cards to findings on matching assets.' : 'Finding field: the asset cards then count assets with an open matching finding.'}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Operator" value={draft.operator} onChange={(e) => onChange({ ...draft, operator: e.target.value, value: NO_VALUE_OPS.has(e.target.value) ? null : Array.isArray(draft.value) && !['is one of', 'is none of', 'between'].includes(e.target.value) ? draft.value[0] ?? null : draft.value })}>
          {ops.map((o) => <option key={o} value={o}>{o}</option>)}
        </NativeSelect>
        <ValueInput entity={draft.entity} field={draft.field} operator={draft.operator} value={draft.value} onChange={(value) => onChange({ ...draft, value })} onPatch={(p) => onChange({ ...draft, ...(p.operator ? { operator: p.operator } : {}), value: p.value })} />
      </div>
      <div className="flex justify-end gap-2"><Button onClick={onCancel}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={onApply}>Apply</Button></div>
    </div>
  );
}

export function ExtraFilters() {
  const { filters, patch } = useFilters();
  const { fields, loading, error } = useFilterFields();
  const [draft, setDraft] = useState<Draft | null>(null);
  const extras = filters.extra ?? [];
  const find = (e: ExtraFilter) => fields.find((f) => f.entity === e.entity && f.key === e.condition.field);

  const start = (f: Pick) => setDraft({ field: f, entity: f.entity, operator: (f.operators?.length ? f.operators : OPERATORS[f.type])[0], value: null });
  const edit = (e: ExtraFilter) => { const f = find(e); if (f) setDraft({ id: e.id, field: f, entity: e.entity, operator: e.condition.operator, value: e.condition.value }); };
  const apply = () => {
    if (!draft) return;
    const item: ExtraFilter = { id: draft.id ?? uid(), entity: draft.entity, condition: { type: 'condition', field: draft.field.key, operator: draft.operator, value: NO_VALUE_OPS.has(draft.operator) ? null : draft.value, not: false } };
    patch({ extra: draft.id ? extras.map((x) => (x.id === draft.id ? item : x)) : [...extras, item] });
    setDraft(null);
  };
  if (extras.length > 20) toast.warning('Too many filters', 'At most 20 added filters.');

  return (
    <>
      {extras.map((e) => {
        const f = find(e);
        return (
          <span key={e.id} className="inline-flex items-center rounded-md border border-primary/30 bg-accent text-xs" title={e.entity === 'assets' ? 'Asset field' : 'Finding field'}>
            <button className="max-w-[18rem] truncate rounded-l-md px-2 py-1.5 hover:bg-muted/60" onClick={() => edit(e)} aria-label={`Edit filter ${f?.label ?? e.condition.field}`}>
              <span className="text-muted-foreground">{f?.label ?? e.condition.field} </span><b className="font-medium">{summary(e)}</b>
            </button>
            <button className="rounded-r-md px-1.5 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground" onClick={() => patch({ extra: extras.filter((x) => x.id !== e.id) })} aria-label={`Remove filter ${f?.label ?? e.condition.field}`}><X size={12} /></button>
          </span>
        );
      })}
      <FieldPicker fields={fields} onSelect={(f) => start(f as Pick)} ariaLabel="Add a filter on any column">
        <span className="inline-flex items-center gap-1 text-sm"><Plus size={14} /> Add filter</span>
      </FieldPicker>
      {error && <span className="text-xs text-sev-critical">Could not load the column list</span>}
      {loading && <span className="text-xs text-muted-foreground">Loading columns…</span>}
      <Modal open={!!draft} onOpenChange={(o) => !o && setDraft(null)} title="Add filter" className="max-w-xl">
        {draft && <Editor draft={draft} onChange={(d) => setDraft({ ...draft, ...d })} onApply={apply} onCancel={() => setDraft(null)} />}
      </Modal>
    </>
  );
}
