import { useRef, useState } from 'react';
import { Bookmark, Download, Save, Trash2, Upload } from 'lucide-react';
import type { Entity } from '@shared/types';
import { Button, Input } from '@/components/ui/primitives';
import { Modal, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import { useSaved } from '@/store/saved';
import { builderStore } from '@/store/builder';
import { downloadText } from '@/lib/utils';
import { toast } from '@/store/toast';

export function SavedViewsMenu({ entity }: { entity: Entity }) {
  const { views, save, remove, exportViews, importViews } = useSaved();
  const store = builderStore(entity);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const mine = views.filter((v) => v.entity === entity);

  const doSave = () => {
    const n = name.trim();
    if (!n) return;
    save(entity, n, store.getState().snapshotView());
    toast.success('View saved', `“${n}” is available in the sidebar.`);
    setSaving(false);
    setName('');
  };
  const doImport = async (f?: File) => {
    if (!f) return;
    try {
      const n = importViews(await f.text());
      toast.success('Import complete', `${n} view${n === 1 ? '' : 's'} imported.`);
    } catch {
      toast.error('Import failed', 'The file is not a valid saved-views export.');
    }
    if (file.current) file.current.value = '';
  };

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm"><Bookmark size={14} /> Saved views <span className="rounded bg-muted px-1 text-[10px]">{mine.length}</span></Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          <Button size="sm" variant="primary" className="mb-2 w-full" onClick={() => setSaving(true)}><Save size={14} /> Save current query as…</Button>
          <ul className="max-h-64 overflow-auto">
            {mine.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">No saved views for this page yet.</li>}
            {mine.map((v) => (
              <li key={v.id} className="group flex items-center rounded hover:bg-muted">
                <button className="flex-1 truncate px-2 py-1.5 text-left text-sm" onClick={() => store.getState().loadView(v)}>{v.name}</button>
                <button className="mr-1 rounded p-1 text-muted-foreground hover:text-sev-critical" onClick={() => remove(v.id)} aria-label={`Delete saved view ${v.name}`}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2 border-t border-border pt-2">
            <Button size="sm" className="flex-1" onClick={() => downloadText('vip_saved_views.json', exportViews(), 'application/json')} disabled={views.length === 0}><Download size={14} /> Export</Button>
            <Button size="sm" className="flex-1" onClick={() => file.current?.click()}><Upload size={14} /> Import</Button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void doImport(e.target.files?.[0])} />
          </div>
        </PopoverContent>
      </Popover>
      <Modal open={saving} onOpenChange={setSaving} title="Save view">
        <form onSubmit={(e) => { e.preventDefault(); doSave(); }} className="space-y-3">
          <Input autoFocus placeholder="View name" aria-label="View name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <p className="text-xs text-muted-foreground">Saves the filters, columns, sort and snapshot options in this browser. Same name overwrites.</p>
          <div className="flex justify-end gap-2"><Button onClick={() => setSaving(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={!name.trim()}>Save</Button></div>
        </form>
      </Modal>
    </>
  );
}
