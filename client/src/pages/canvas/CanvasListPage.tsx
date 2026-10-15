import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Copy, LayoutGrid, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badges';
import { Button, Card, ErrorPanel, Input, Skeleton } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlay';
import { CanvasApi } from '@/lib/canvas';
import { SavedApi, useMe } from '@/lib/savedQueries';
import { toast } from '@/store/toast';

export default function CanvasListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const me = useMe();
  const list = useQuery({ queryKey: ['canvases'], queryFn: CanvasApi.list, retry: false });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const build = sp.get('build');
  const started = useRef(false);

  // "Chart" from the Saved queries page: start a new canvas for that query and open the chart builder.
  useEffect(() => {
    if (!build || started.current) return;
    started.current = true;
    (async () => {
      try {
        const q = (await SavedApi.list()).find((x) => x.id === build);
        if (!q) throw new Error('That saved query is not available');
        const c = await CanvasApi.create({ name: `${q.name}: charts`, tiles: [] });
        await qc.invalidateQueries({ queryKey: ['canvases'] });
        navigate(`/dashboard/canvas/${c.id}?add=${q.id}`, { replace: true });
      } catch (e: any) { toast.error('Could not start a chart', e?.message); setSp({}, { replace: true }); started.current = false; }
    })();
  }, [build, navigate, qc, setSp]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await qc.invalidateQueries({ queryKey: ['canvases'] }); toast.success(ok); } catch (e: any) { toast.error('Failed', e?.message); }
  };
  const create = async () => {
    try { const c = await CanvasApi.create({ name: name.trim(), tiles: [] }); await qc.invalidateQueries({ queryKey: ['canvases'] }); setCreating(false); setName(''); navigate(`/dashboard/canvas/${c.id}`); } catch (e: any) { toast.error('Could not create', e?.message); }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-[34px] leading-none">Canvas</h1>
          <p className="mt-2 text-xs text-muted-foreground">Build dashboards of charts from your saved queries.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> New canvas</Button>
      </div>
      {build && <p className="text-sm text-muted-foreground">Preparing your canvas…</p>}
      {list.isError && <ErrorPanel message={(list.error as Error).message} onRetry={() => void list.refetch()} />}
      {list.isLoading ? <Skeleton className="h-40" /> : (list.data?.length ?? 0) === 0 ? (
        <Card className="p-10 text-center">
          <LayoutGrid className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm">No canvases yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">Create one, then add charts from your saved queries.</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data!.map((c) => {
            const mine = c.owner === me.data;
            return (
              <Card key={c.id} className="flex flex-col justify-between p-4">
                <div>
                  <button className="text-left text-sm font-medium hover:underline" onClick={() => navigate(`/dashboard/canvas/${c.id}`)}>{c.name}</button>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Badge>{c.tiles.length} chart{c.tiles.length === 1 ? '' : 's'}</Badge>
                    {c.visibility === 'team' ? <Badge tone="primary">Team</Badge> : <Badge>Private</Badge>}
                    {!mine && <span>by {c.owner}</span>}
                    <span>· {new Date(c.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1">
                  <Button size="sm" onClick={() => navigate(`/dashboard/canvas/${c.id}`)}>Open</Button>
                  <Button size="sm" variant="ghost" aria-label={`Duplicate ${c.name}`} title="Duplicate" onClick={() => void act(() => CanvasApi.duplicate(c.id), 'Duplicated')}><Copy size={14} /></Button>
                  {mine && <>
                    <Button size="sm" variant="ghost" aria-label={`Rename ${c.name}`} title="Rename" onClick={() => { const n = window.prompt('Rename canvas', c.name); if (n?.trim()) void act(() => CanvasApi.update(c.id, { name: n.trim() }), 'Renamed'); }}><Pencil size={14} /></Button>
                    <Button size="sm" variant="ghost" aria-label={c.visibility === 'team' ? 'Make private' : 'Share with team'} title={c.visibility === 'team' ? 'Make private' : 'Share with team'} onClick={() => void act(() => CanvasApi.update(c.id, { visibility: c.visibility === 'team' ? 'private' : 'team' }), 'Sharing updated')}><Users size={14} /></Button>
                    <Button size="sm" variant="ghost" className="ml-auto hover:text-sev-critical" aria-label={`Delete ${c.name}`} title="Delete" onClick={() => { if (window.confirm(`Delete “${c.name}”?`)) void act(() => CanvasApi.remove(c.id), 'Deleted'); }}><Trash2 size={14} /></Button>
                  </>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal open={creating} onOpenChange={setCreating} title="New canvas">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Canvas name" aria-label="Canvas name" maxLength={120} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />
        <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => void create()}>Create</Button></div>
      </Modal>
    </div>
  );
}
