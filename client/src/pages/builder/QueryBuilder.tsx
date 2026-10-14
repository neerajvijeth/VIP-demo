import { useEffect, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, ChevronDown, ChevronRight, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { Condition, Entity, FieldDef, Group, Node } from '@shared/types';
import { MULTI_OPS, NO_VALUE_OPS, OPERATORS } from '@shared/types';
import { Button, NativeSelect, Segmented } from '@/components/ui/primitives';
import { FieldPicker } from '@/components/ui/pickers';
import { ValueInput } from './ValueInput';
import { builderStore } from '@/store/builder';
import { findParent, isComplete } from '@/lib/tree';
import { cn } from '@/lib/utils';

const RAILS = ['hsl(var(--primary))', 'hsl(var(--primary) / 0.75)', 'hsl(var(--primary) / 0.55)', 'hsl(var(--primary) / 0.4)', 'hsl(var(--primary) / 0.3)', 'hsl(var(--primary) / 0.22)'];

const OP_HINT: Record<string, string> = {
  'is none of': 'Also matches rows where the field is empty (NULL).',
  'is not': 'Also matches rows where the field is empty (NULL).',
  'does not contain': 'Also matches rows where the field is empty (NULL).',
  '≠': 'Also matches rows where the field is empty (NULL).',
};

function shape(op: string) {
  return NO_VALUE_OPS.has(op) ? 'none' : MULTI_OPS.has(op) ? 'multi' : op === 'between' ? 'range' : 'single';
}

function Sortable({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button type="button" className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing" aria-label="Drag to reorder" {...attributes} {...listeners}>
      <GripVertical size={15} />
    </button>
  );
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'z-10 opacity-60')}>
      {children(handle)}
    </div>
  );
}

function NotChip({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label="Negate this expression (NOT)"
      title="Negate this expression (NOT)"
      className={cn('h-7 w-7 shrink-0 rounded-md border text-sm font-semibold transition-colors', on ? 'border-sev-critical/50 bg-sev-critical/15 text-sev-critical' : 'border-border text-muted-foreground hover:bg-muted')}
    >
      ¬
    </button>
  );
}

function ConditionRow({ entity, node, handle, fields, map }: { entity: Entity; node: Condition; handle: ReactNode; fields: FieldDef[]; map: Map<string, FieldDef> }) {
  const s = builderStore(entity);
  const patch = s((st) => st.patchNode);
  const remove = s((st) => st.remove);
  const duplicate = s((st) => st.duplicate);
  const wrap = s((st) => st.wrap);
  const f = map.get(node.field);
  const ops = f ? f.operators?.length ? f.operators : OPERATORS[f.type] : [];
  const complete = isComplete(node, map);
  const id = node.id!;

  const onField = (nf: FieldDef) => {
    const sameType = f && f.type === nf.type;
    patch(id, { field: nf.key, operator: sameType && ops.includes(node.operator) ? node.operator : OPERATORS[nf.type][0], value: sameType && nf.type !== 'enum' ? node.value : null });
  };
  const onOp = (op: string) => {
    const keep = shape(op) === shape(node.operator);
    patch(id, { operator: op, value: keep ? node.value : null });
  };

  return (
    <div className="group/row flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/70 px-2 py-1.5" role="group" aria-label="Filter condition">
      {handle}
      <NotChip on={node.not} onToggle={() => patch(id, { not: !node.not })} />
      <FieldPicker fields={fields} value={node.field} onSelect={onField} />
      {f && (
        <NativeSelect aria-label="Operator" value={node.operator} onChange={(e) => onOp(e.target.value)} title={OP_HINT[node.operator]} className="max-w-[11rem]">
          {ops.map((o) => <option key={o} value={o}>{o}</option>)}
        </NativeSelect>
      )}
      {f && <ValueInput entity={entity} field={f} operator={node.operator} value={node.value} onChange={(v) => patch(id, { value: v })} onPatch={(p) => patch(id, p)} />}
      {OP_HINT[node.operator] && <span className="hidden text-[10px] text-muted-foreground xl:inline" title={OP_HINT[node.operator]}>incl. empty</span>}
      <div className="ml-auto flex items-center gap-0.5">
        {!complete && <span title="Incomplete — ignored when the query runs" className="mr-1 text-sev-medium"><AlertCircle size={15} aria-label="Incomplete condition" /></span>}
        <Button variant="ghost" size="iconSm" onClick={() => wrap(id)} aria-label="Wrap in brackets" title="Wrap in brackets ( … )"><span className="mono text-[13px] font-semibold leading-none">( )</span></Button>
        <Button variant="ghost" size="iconSm" onClick={() => duplicate(id)} aria-label="Duplicate condition"><Copy size={14} /></Button>
        <Button variant="ghost" size="iconSm" onClick={() => remove(id)} aria-label="Delete condition"><Trash2 size={14} /></Button>
      </div>
    </div>
  );
}

function DropZone({ groupId, children }: { groupId: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${groupId}` });
  return <div ref={setNodeRef} className={cn('rounded-md transition-colors', isOver && 'bg-primary/10 ring-1 ring-primary/40')}>{children}</div>;
}

function AddCondition({ entity, groupId, fields, listen }: { entity: Entity; groupId: string; fields: FieldDef[]; listen?: boolean }) {
  const add = builderStore(entity)((s) => s.addCondition);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!listen) return;
    const h = () => setOpen(true);
    window.addEventListener('vip:focus-field-search', h);
    return () => window.removeEventListener('vip:focus-field-search', h);
  }, [listen]);
  return (
    <FieldPicker fields={fields} open={open} onOpenChange={setOpen} onSelect={(f) => add(groupId, f)} ariaLabel="Add condition" triggerClassName="min-w-0 border-dashed text-muted-foreground hover:text-foreground">
      <Plus size={14} /> Condition
    </FieldPicker>
  );
}

function GroupView({ entity, node, depth, handle, fields, map }: { entity: Entity; node: Group; depth: number; handle?: ReactNode; fields: FieldDef[]; map: Map<string, FieldDef> }) {
  const s = builderStore(entity);
  const patch = s((st) => st.patchNode);
  const setOp = s((st) => st.setOp);
  const remove = s((st) => st.remove);
  const duplicate = s((st) => st.duplicate);
  const wrap = s((st) => st.wrap);
  const ungroup = s((st) => st.ungroup);
  const addGroup = s((st) => st.addGroup);
  const [collapsed, setCollapsed] = useState(false);
  const id = node.id!;
  const rail = RAILS[(depth - 1) % RAILS.length];
  const isRoot = depth === 1;

  return (
    <div className="rounded-lg border border-border bg-muted/30" style={{ borderLeft: `3px solid ${rail}` }} role="group" aria-label={`Group ${node.op}`}>
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        {!isRoot && <span className="mono select-none text-2xl font-light leading-none" style={{ color: rail }} aria-hidden>(</span>}
        {handle}
        <button className="rounded p-0.5 text-muted-foreground hover:bg-muted" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand group' : 'Collapse group'}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <Segmented size="sm" ariaLabel="Set every connector in this group" value={node.op} onChange={(op) => setOp(id, op)} options={[{ value: 'AND', label: 'AND', title: 'Join all items in this group with AND (click a connector between rows to change just one)' }, { value: 'OR', label: 'OR', title: 'Join all items in this group with OR (click a connector between rows to change just one)' }]} />
        <NotChip on={node.not} onToggle={() => patch(id, { not: !node.not })} />
        <span className="text-xs text-muted-foreground">{isRoot ? 'Match' : 'Group'} · {node.children.length} item{node.children.length === 1 ? '' : 's'}</span>
        {!isRoot && (
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="iconSm" onClick={() => ungroup(id)} aria-label="Remove brackets" title="Remove brackets (keep the items)"><span className="mono text-[13px] font-semibold leading-none">) (</span></Button>
            <Button variant="ghost" size="iconSm" onClick={() => wrap(id)} aria-label="Wrap group in brackets" title="Wrap in another pair of brackets"><span className="mono text-[13px] font-semibold leading-none">( )</span></Button>
            <Button variant="ghost" size="iconSm" onClick={() => duplicate(id)} aria-label="Duplicate group"><Copy size={14} /></Button>
            <Button variant="ghost" size="iconSm" onClick={() => remove(id)} aria-label="Delete group"><Trash2 size={14} /></Button>
          </div>
        )}
      </div>
      {!collapsed && (
        <div className="space-y-2 px-2 pb-2 pl-3">
          <SortableContext items={node.children.map((c) => c.id!)} strategy={verticalListSortingStrategy}>
            <DropZone groupId={id}>
              <div className="space-y-2">
                {node.children.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No conditions yet — add one below, or drop an item here.</p>}
                {node.children.map((c, i) => (
                  <div key={c.id} className="relative pt-0.5">
                    {i > 0 && (() => {
                      const eff = c.join ?? node.op;
                      return (
                        <button
                          type="button"
                          onClick={() => patch(c.id!, { join: eff === 'AND' ? 'OR' : 'AND' })}
                          className={cn('absolute -top-[11px] left-4 z-[2] rounded-sm border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider transition-colors', eff === 'OR' ? 'border-primary/40 bg-accent text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground')}
                          title={`Connects this item to the one above with ${eff}. Click to switch to ${eff === 'AND' ? 'OR' : 'AND'}.`}
                          aria-label={`Connector: ${eff}. Click to change to ${eff === 'AND' ? 'OR' : 'AND'}`}
                        >
                          {eff}
                        </button>
                      );
                    })()}
                    <Sortable id={c.id!}>
                      {(h) => c.type === 'group' ? <GroupView entity={entity} node={c} depth={depth + 1} handle={h} fields={fields} map={map} /> : <ConditionRow entity={entity} node={c} handle={h} fields={fields} map={map} />}
                    </Sortable>
                  </div>
                ))}
              </div>
            </DropZone>
          </SortableContext>
          <div className="flex flex-wrap items-center gap-2">
            <AddCondition entity={entity} groupId={id} fields={fields} listen={isRoot} />
            <Button size="sm" variant="outline" className="h-9 border-dashed text-muted-foreground hover:text-foreground" onClick={() => addGroup(id)} disabled={depth >= 6} title={depth >= 6 ? 'Maximum nesting depth reached' : 'Open a new bracketed group'}>
              <span className="mono font-semibold">(</span> Group <span className="mono font-semibold">)</span>
            </Button>
          </div>
          {!isRoot && <div className="mono select-none text-right text-2xl font-light leading-none pr-1" style={{ color: rail }} aria-hidden>)</div>}
        </div>
      )}
    </div>
  );
}

export function QueryBuilder({ entity, fields, map }: { entity: Entity; fields: FieldDef[]; map: Map<string, FieldDef> }) {
  const s = builderStore(entity);
  const tree = s((st) => st.tree);
  const move = s((st) => st.move);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const overId = String(over.id);
    if (overId.startsWith('drop:')) return move(String(active.id), overId.slice(5));
    const parent = findParent(tree, overId);
    if (!parent) return;
    move(String(active.id), parent.id!, parent.children.findIndex((c: Node) => c.id === overId));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <GroupView entity={entity} node={tree} depth={1} fields={fields} map={map} />
    </DndContext>
  );
}
