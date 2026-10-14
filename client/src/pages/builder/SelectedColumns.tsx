import { RotateCcw, X } from 'lucide-react';
import type { Entity, FieldDef } from '@shared/types';
import { builderStore, effectiveColumns } from '@/store/builder';
import { ColumnsEditor } from './ColumnsEditor';

/** The SELECT list: chips for every returned column, plus the picker to add, reorder or reset. */
export function SelectedColumns({ entity, columns, columnMap }: { entity: Entity; columns: FieldDef[]; columnMap: Map<string, FieldDef> }) {
  const st = builderStore(entity)((s) => s);
  const selected = effectiveColumns(st);
  const remove = (key: string) => selected.length > 1 && st.setColumns(selected.filter((k) => k !== key));

  return (
    <div className="rounded-md border border-border p-3" aria-label="Columns to return">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Columns to return · SELECT <span className="num normal-case tracking-normal">({selected.length})</span></span>
        <div className="flex items-center gap-1.5">
          {st.columns !== null && (
            <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => st.setColumns(null)}><RotateCcw size={12} /> Reset to default</button>
          )}
          <ColumnsEditor entity={entity} columns={columns} />
        </div>
      </div>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
        {selected.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs" title={k}>
            {columnMap.get(k)?.label ?? k}
            <button className="text-muted-foreground hover:text-sev-critical disabled:opacity-30" onClick={() => remove(k)} disabled={selected.length <= 1} aria-label={`Remove column ${columnMap.get(k)?.label ?? k}`}><X size={11} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}
