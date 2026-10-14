import { useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Columns3, GripVertical, RotateCcw, X } from 'lucide-react';
import type { Entity, FieldDef } from '@shared/types';
import { Button, Input } from '@/components/ui/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import { builderStore, effectiveColumns } from '@/store/builder';

function Item({ id, label, onRemove }: { id: string; label: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-1.5 rounded px-1 py-1 text-sm hover:bg-muted ${isDragging ? 'opacity-60' : ''}`}>
      <button className="cursor-grab touch-none text-muted-foreground" aria-label={`Drag ${label}`} {...attributes} {...listeners}><GripVertical size={14} /></button>
      <span className="flex-1 truncate">{label}</span>
      <button className="text-muted-foreground hover:text-sev-critical" onClick={onRemove} aria-label={`Remove column ${label}`}><X size={13} /></button>
    </li>
  );
}

export function ColumnsEditor({ entity, columns }: { entity: Entity; columns: FieldDef[] }) {
  const s = builderStore(entity);
  const state = s((st) => st);
  const selected = effectiveColumns(state);
  const [q, setQ] = useState('');
  const label = useMemo(() => new Map(columns.map((c) => [c.key, c.label])), [columns]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const groups = useMemo(() => {
    const m = new Map<string, FieldDef[]>();
    const needle = q.trim().toLowerCase();
    for (const c of columns) {
      if (needle && !(c.label.toLowerCase().includes(needle) || c.key.includes(needle))) continue;
      (m.get(c.group) ?? m.set(c.group, []).get(c.group)!).push(c);
    }
    const entries = [...m.entries()];
    entries.sort(([a], [b]) => (a === 'More fields…' ? 1 : b === 'More fields…' ? -1 : 0));
    return entries;
  }, [columns, q]);

  const toggle = (key: string) => state.setColumns(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    state.setColumns(arrayMove(selected, selected.indexOf(String(active.id)), selected.indexOf(String(over.id))));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm"><Columns3 size={14} /> Add / edit columns</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(94vw,40rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Columns</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => state.setColumns(groups.flatMap(([, l]) => l.map((c) => c.key)).slice(0, 250))} title="Select every column currently listed (respects the search box)">Select all</Button>
            <Button size="sm" variant="ghost" onClick={() => state.setColumns(selected.slice(0, 1))} title="Keep only the first column">Clear</Button>
            <Button size="sm" variant="ghost" onClick={() => state.setColumns(null)} disabled={state.columns === null}><RotateCcw size={13} /> Default</Button>
          </div>
        </div>
        <div className="grid gap-0 sm:grid-cols-2">
          <div className="border-b border-border p-2 sm:border-b-0 sm:border-r">
            <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shown · drag to reorder</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={selected} strategy={verticalListSortingStrategy}>
                <ul className="max-h-72 overflow-auto">
                  {selected.map((k) => <Item key={k} id={k} label={label.get(k) ?? k} onRemove={() => toggle(k)} />)}
                </ul>
              </SortableContext>
            </DndContext>
            {selected.length === 0 && <p className="p-2 text-xs text-muted-foreground">Select at least one column (defaults are used if none).</p>}
          </div>
          <div className="p-2">
            <Input placeholder="Search all columns…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search columns" className="mb-2 h-8" />
            <div className="max-h-72 overflow-auto">
              {groups.map(([g, list]) => (
                <div key={g} className="mb-1">
                  <div className="sticky top-0 bg-popover px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</div>
                  {list.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                      <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={selected.includes(c.key)} onChange={() => toggle(c.key)} />
                      <span className="truncate">{c.label}</span>
                    </label>
                  ))}
                </div>
              ))}
              {groups.length === 0 && <p className="p-2 text-xs text-muted-foreground">No columns match.</p>}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
