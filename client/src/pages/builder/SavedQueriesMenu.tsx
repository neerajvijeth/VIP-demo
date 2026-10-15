import { useState } from 'react';
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
export function SavedQueriesMenu({ entity }: { entity: Entity }) {
  const qc = useQueryClient();
  const store = builderStore(entity);
  const list = useSavedSql();
  const me = useMe();
  const loadedId = useLoadedSaved((s) => s.ids[entity]);
  const setLoaded = useLoadedSaved((s) => s.set);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' });
  const mine = (list.data ?? []).filter((q) => q.kind === 'builder' && q.entity === entity);
  const loaded = mine.find((q) => q.id === loadedId);
  const canUpdate = !!loaded && loaded.owner === me.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['saved-sql'] });

  const saveNew = async () => {
    try {
      const q = await SavedApi.create({ ...form, kind: 'builder', entity, payload: store.getState().snapshotView() });
      await refresh(); setLoaded(entity, q.id); setSaving(false); setOpen(false);
      toast.success('Query saved', `“${q.name}” is in Saved queries and can be used on Canvas.`);
    } catch (e: any) { toast.error('Could not save', e?.message); }
  };
  const update = async () => {
    if (!loaded) return;
    try {
      const q = await SavedApi.update(loaded.id, { payload: store.getState().snapshotView() });
      await refresh(); setOpen(false);
      toast.success(q.version === loaded.version ? 'No changes to save' : `Saved as v${q.version}`);
    } catch (e: any) { toast.error('Could not update', e?.message); }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm"><Bookmark size={14} /> Saved queries <span className="rounded bg-muted px-1 text-[10px]">{mine.length}</span></Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          <Button size="sm" variant="primary" className="mb-1 w-full" onClick={() => { setForm({ name: '', description: '', visibility: 'private' }); setSaving(true); }}><Save size={14} /> Save current query as…</Button>
          {canUpdate && <Button size="sm" className="mb-2 w-full" onClick={() => void update()}>Update “{loaded!.name}” (v{loaded!.version})</Button>}
          <ul className="max-h-64 overflow-auto">
            {list.isLoading && <li className="px-2 py-3 text-xs text-muted-foreground">Loading…</li>}
            {!list.isLoading && mine.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">No saved queries for this page yet.</li>}
            {mine.map((q) => (
              <li key={q.id}>
                <button className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${q.id === loadedId ? 'bg-accent' : ''}`} onClick={() => { loadBuilderQuery(q); setOpen(false); }} title={q.description || q.name}>
                  <span className="truncate">{q.name}</span>{q.owner !== me.data && <span className="shrink-0 text-[10px] text-muted-foreground">shared</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-border pt-2 text-xs"><Link to="/dashboard/saved" className="text-primary hover:underline" onClick={() => setOpen(false)}>Manage all saved queries</Link></div>
        </PopoverContent>
      </Popover>
      <Modal open={saving} onOpenChange={setSaving} title="Save query">
        <form onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) void saveNew(); }} className="space-y-3">
          <Input autoFocus placeholder="Query name" aria-label="Query name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Description (optional)" aria-label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <NativeSelect className="w-full" value={form.visibility} aria-label="Visibility" onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="private">Private (only me)</option><option value="team">Team (everyone can open it)</option></NativeSelect>
          <p className="text-xs text-muted-foreground">Saves the filters, columns, sort, summary and snapshot options. You can chart it on Canvas.</p>
          <div className="flex justify-end gap-2"><Button onClick={() => setSaving(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={!form.name.trim()}>Save</Button></div>
        </form>
      </Modal>
    </>
  );
}
