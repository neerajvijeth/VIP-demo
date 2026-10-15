import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowLeft, GripVertical, Lock, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { ChartView } from '@/components/charts/ChartView';
import { Badge } from '@/components/ui/badges';
import { Button, Card, ErrorPanel, Input, Segmented, Skeleton } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import { CanvasApi, type Canvas, type Tile } from '@/lib/canvas';
import { useMe } from '@/lib/savedQueries';
import { toast } from '@/store/toast';
import { TileBuilder } from './TileBuilder';

const WIDTHS = [3, 4, 6, 8, 12];
const HEIGHTS = [2, 3, 4, 5, 6];
const cycle = (arr: number[], v: number) => arr[(arr.indexOf(v) + 1) % arr.length] ?? arr[0];

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => { const m = window.matchMedia('(min-width: 1024px)'); const f = () => setWide(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return wide;
}

function TileCard({ tile, editable, handle, onEdit, onRemove, onSize }: { tile: Tile; editable: boolean; handle?: React.ReactNode; onEdit: () => void; onRemove: () => void; onSize: (w: number, h: number) => void }) {
  const q = useQuery({
    queryKey: ['canvas-tile', tile.query_id, tile.query_version, tile.chart],
    retry: false,
    queryFn: ({ signal }) => CanvasApi.tile({ query_id: tile.query_id, query_version: tile.query_version, chart: tile.chart }, signal),
  });
  const d = q.data;
  const btn = 'rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground';
  return (
    <Card className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-start gap-1.5">
        {handle}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={tile.title}>{tile.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            {d?.query ? <span className="truncate" title={d.query.name}>{d.query.name}</span> : null}
            <Badge className="!text-[10px]">{tile.query_version === 'latest' ? `latest${d?.query ? ` · v${d.query.version}` : ''}` : `pinned v${tile.query_version}`}</Badge>
          </div>
        </div>
        {editable && (
          <div className="no-print flex shrink-0 items-center">
            <button className={btn} title="Change width" aria-label="Change width" onClick={() => onSize(cycle(WIDTHS, tile.w), tile.h)}><span className="num text-[10px]">↔{tile.w}</span></button>
            <button className={btn} title="Change height" aria-label="Change height" onClick={() => onSize(tile.w, cycle(HEIGHTS, tile.h))}><span className="num text-[10px]">↕{tile.h}</span></button>
            <button className={btn} title="Edit chart" aria-label="Edit chart" onClick={onEdit}><Pencil size={14} /></button>
            <button className={`${btn} hover:!text-sev-critical`} title="Remove chart" aria-label="Remove chart" onClick={onRemove}><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      <div className={`min-h-0 flex-1 overflow-auto ${q.isFetching && !q.isPending ? 'opacity-70' : ''}`}>
        {q.isPending ? <div className="space-y-2"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-28 w-full" /></div>
          : q.isError ? <ErrorPanel message={(q.error as ApiError).message} detail={(q.error as ApiError).detail} onRetry={() => void q.refetch()} />
          : d?.state === 'ok' ? <><ChartView chart={tile.chart} data={d} />{d.capped && <p className="mt-1 text-[11px] text-sev-medium">Capped at 1,000 groups/rows.</p>}</>
          : d?.state === 'no_access' ? <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground"><Lock size={14} className="mt-0.5 shrink-0" /> {d.message}</div>
          : <div role="alert" className="rounded-md border border-sev-critical/30 bg-sev-critical/10 p-3 text-xs"><div className="flex items-center gap-1.5 font-medium text-sev-critical"><AlertTriangle size={14} /> This chart cannot be drawn</div><p className="mt-1 break-words text-muted-foreground">{d?.message}</p>{editable && <button className="mt-1 text-primary hover:underline" onClick={onEdit}>Edit chart</button>}</div>}
      </div>
    </Card>
  );
}

function SortableTile({ tile, wide, children }: { tile: Tile; wide: boolean; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id });
  const handle = <button className="no-print mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing" aria-label="Drag to reorder" {...attributes} {...listeners}><GripVertical size={14} /></button>;
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, gridColumn: wide ? `span ${tile.w}` : undefined, minHeight: tile.h * 100, opacity: isDragging ? 0.6 : 1 }}>{children(handle)}</div>;
}

export default function CanvasEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const wide = useWide();
  const me = useMe();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const q = useQuery({ queryKey: ['canvas', id], queryFn: () => CanvasApi.get(id), retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [builder, setBuilder] = useState<{ tile: Tile | null; preset?: string | null } | null>(null);
  const [status, setStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef(false);

  useEffect(() => { if (q.data) { setCanvas(q.data); dirty.current = false; setStatus('idle'); } }, [q.data]);
  const readOnly = !!canvas && !!me.data && canvas.owner !== me.data;

  const change = useCallback((fn: (c: Canvas) => Canvas) => { dirty.current = true; setStatus('dirty'); setCanvas((c) => (c ? fn(c) : c)); }, []);

  // autosave (owner only)
  useEffect(() => {
    if (!canvas || !dirty.current || readOnly) return;
    const t = setTimeout(async () => {
      setStatus('saving');
      try { await CanvasApi.update(canvas.id, { name: canvas.name, visibility: canvas.visibility, tiles: canvas.tiles }); dirty.current = false; setStatus('saved'); }
      catch (e: any) { setStatus('error'); toast.error('Could not save the canvas', e?.message); }
    }, 800);
    return () => clearTimeout(t);
  }, [canvas, readOnly]);

  // ?add=<savedQueryId> opens the builder for that query ("Chart" on the Saved queries page)
  const add = sp.get('add');
  useEffect(() => { if (add && canvas && !readOnly) { setBuilder({ tile: null, preset: add }); setSp({}, { replace: true }); } }, [add, canvas, readOnly, setSp]);

  if (q.isLoading) return <Skeleton className="m-6 h-64" />;
  if (q.isError) return <div className="m-6 space-y-2"><ErrorPanel message={(q.error as Error).message} onRetry={() => void q.refetch()} /><Link to="/dashboard/canvas" className="text-sm text-primary">Back to canvases</Link></div>;
  if (!canvas) return null;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    change((c) => ({ ...c, tiles: arrayMove(c.tiles, c.tiles.findIndex((t) => t.id === e.active.id), c.tiles.findIndex((t) => t.id === e.over!.id)) }));
  };
  const upsert = (t: Tile) => change((c) => ({ ...c, tiles: c.tiles.some((x) => x.id === t.id) ? c.tiles.map((x) => (x.id === t.id ? t : x)) : [...c.tiles, t] }));
  const statusText = { idle: '', dirty: 'Unsaved changes…', saving: 'Saving…', saved: 'All changes saved', error: 'Save failed' }[status];

  return (
    <div className="mx-auto max-w-[1800px] space-y-3 p-4 sm:p-6">
      <div className="no-print flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => navigate('/dashboard/canvas')}><ArrowLeft size={14} /> Canvases</Button>
        <Input value={canvas.name} disabled={readOnly} onChange={(e) => change((c) => ({ ...c, name: e.target.value }))} className="h-9 max-w-xs font-medium" aria-label="Canvas name" maxLength={120} />
        <Segmented size="sm" value={canvas.visibility} onChange={(v) => !readOnly && change((c) => ({ ...c, visibility: v }))} ariaLabel="Sharing" options={[{ value: 'private', label: 'Private' }, { value: 'team', label: 'Team' }]} />
        <span className="text-xs text-muted-foreground" aria-live="polite">{statusText}</span>
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" onClick={() => window.print()} title="Print or save as PDF"><Printer size={14} /> PDF</Button>
          <Button size="sm" variant="primary" disabled={readOnly} onClick={() => setBuilder({ tile: null })}><Plus size={14} /> Add chart</Button>
        </span>
      </div>
      <h1 className="hidden font-display text-3xl print:block">{canvas.name}</h1>
      {readOnly && <div className="no-print flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs"><Lock size={13} /> Shared by {canvas.owner}. You can view it, but only the owner can edit. Charts run with your own data access. <button className="text-primary underline" onClick={async () => { try { const c = await CanvasApi.duplicate(canvas.id); navigate(`/dashboard/canvas/${c.id}`); } catch (e: any) { toast.error('Could not duplicate', e?.message); } }}>Duplicate to edit</button></div>}

      {canvas.tiles.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm">This canvas is empty.</p>
          <p className="mt-1 text-xs text-muted-foreground">Add a chart: pick a saved query and choose how to draw it.</p>
          <Button className="mt-3" variant="primary" disabled={readOnly} onClick={() => setBuilder({ tile: null })}><Plus size={14} /> Add chart</Button>
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={canvas.tiles.map((t) => t.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              {canvas.tiles.map((t) => (
                <SortableTile key={t.id} tile={t} wide={wide}>
                  {(handle) => <TileCard tile={t} editable={!readOnly} handle={readOnly ? null : handle} onEdit={() => setBuilder({ tile: t })} onRemove={() => { if (window.confirm(`Remove “${t.title}” from this canvas?`)) change((c) => ({ ...c, tiles: c.tiles.filter((x) => x.id !== t.id) })); }} onSize={(w, h) => change((c) => ({ ...c, tiles: c.tiles.map((x) => (x.id === t.id ? { ...x, w, h } : x)) }))} />}
                </SortableTile>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <TileBuilder open={!!builder} initial={builder?.tile} presetQueryId={builder?.preset} onClose={() => setBuilder(null)} onSave={(t) => { upsert(t); setBuilder(null); }} />
    </div>
  );
}
