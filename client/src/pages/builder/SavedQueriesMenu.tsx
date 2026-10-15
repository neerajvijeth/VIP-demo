import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, Save } from 'lucide-react';
import type { Entity } from '@shared/types';
import { Button, Input, NativeSelect } from '@/components/ui/primitives';
import { Modal, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import { SavedApi, useMe, useSavedSql } from '@/lib/savedQueries';
import { loadBuilderQuery, useLoadedSaved } from '@/lib/openSaved';
import { builderStore } from '@/store/builder';
import { toast } from '@/store/toast';

/** Save / load queries built on the Assets and Vulnerabilities pages. They live in Saved queries (server side) and can feed Canvas charts. */
/** Save dialog shared by the "Save query" button next to Run and the Saved queries menu. */
export function SaveQueryDialog({ entity, open, onOpenChange }: { entity: Entity; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const store = builderStore(entity);
  const list = useSavedSql();
  const me = useMe();
  const loadedId = useLoadedSaved((s) => s.ids[entity]);
  const setLoaded = useLoadedSaved((s) => s.set);
  const loaded = (list.data ?? []).find((q) => q.id === loadedId && q.kind === 'builder' && q.entity === entity);
  const canUpdate = !!loaded && loaded.owner === me.data;
  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' });
  useEffect(() => { if (open) { setForm({ name: '', description: '', visibility: 'private' }); setMode(canUpdate ? 'update' : 'new'); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => qc.invalidateQueries({ queryKey: ['saved-sql'] });

  const submit = async () => {
    try {
      if (mode === 'update' && loaded) {
        const q = await SavedApi.update(loaded.id, { payload: store.getState().snapshotView() });
        await refresh(); onOpenChange(false);
        toast.success(q.version === loaded.version ? 'No changes to save' : `Saved as v${q.version}`, `“${q.name}” is up to date.`);
      } else {
        const q = await SavedApi.create({ ...form, kind: 'builder', entity, payload: store.getState().snapshotView() });
        await refresh(); setLoaded(entity, q.id); onOpenChange(false);
        toast.success('Query saved', `“${q.name}” is in Saved queries and can be used on Canvas.`);
      }
    } catch (e: any) { toast.error('Could not save', e?.message); }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Save query">
      <form onSubmit={(e) => { e.preventDefault(); if (mode === 'update' || form.name.trim()) void submit(); }} className="space-y-3">
        {canUpdate && (
          <div className="inline-flex rounded-md bg-muted p-0.5" role="radiogroup" aria-label="Save as">
            {([['update', `Update “${loaded!.name}” (v${loaded!.version})`], ['new', 'Save as new']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={`rounded-[5px] px-3 py-1 text-xs font-medium ${mode === v ? 'bg-card text-foreground shadow-[0_0_0_1px_hsl(var(--border))]' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>
            ))}
          </div>
        )}
        {mode === 'new' && (
          <>
            <Input autoFocus placeholder="Query name" aria-label="Query name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Description (optional)" aria-label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <NativeSelect className="w-full" value={form.visibility} aria-label="Visibility" onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="private">Private (only me)</option><option value="team">Team (everyone can open it)</option></NativeSelect>
          </>
        )}
        <p className="text-xs text-muted-foreground">Saves the filters, columns, sort, summary and snapshot options. You can chart it on Canvas.</p>
        <div className="flex justify-end gap-2"><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={mode === 'new' && !form.name.trim()}>{mode === 'update' ? 'Update' : 'Save'}</Button></div>
      </form>
    </Modal>
  );
}

/** "Save query" button for the row next to Run query: enabled once the query has been run. */
export function SaveQueryButton({ entity, disabled }: { entity: Entity; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled} title={disabled ? 'Run the query once, then you can save it' : 'Save this query'} aria-label="Save query"><Save size={14} /> Save query</Button>
      <SaveQueryDialog entity={entity} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function SavedQueriesMenu({ entity }: { entity: Entity }) {
  const list = useSavedSql();
  const me = useMe();
  const loadedId = useLoadedSaved((s) => s.ids[entity]);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const mine = (list.data ?? []).filter((q) => q.kind === 'builder' && q.entity === entity);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm"><Bookmark size={14} /> Saved queries <span className="rounded bg-muted px-1 text-[10px]">{mine.length}</span></Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          <Button size="sm" variant="primary" className="mb-2 w-full" onClick={() => { setOpen(false); setSaving(true); }}><Save size={14} /> Save current query…</Button>
          <ul className="max-h-64 overflow-auto">
            {list.isLoading && <li className="px-2 py-3 text-xs text-muted-foreground">Loading…</li>}
            {!list.isLoading && mine.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">No saved queries for this page yet.</li>}
            {mine.map((q) => (
              <li key={q.id}>
                <button className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${q.id === loadedId ? 'bg-accent' : ''}`} onClick={() => { loadBuilderQuery(q); setOpen(false); }} title={q.description || `Apply “${q.name}”`}>
                  <span className="truncate">{q.name}</span>{q.owner !== me.data && <span className="shrink-0 text-[10px] text-muted-foreground">shared</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-border pt-2 text-xs"><Link to="/dashboard/saved" className="text-primary hover:underline" onClick={() => setOpen(false)}>Manage all saved queries</Link></div>
        </PopoverContent>
      </Popover>
      <SaveQueryDialog entity={entity} open={saving} onOpenChange={setSaving} />
    </>
  );
}
