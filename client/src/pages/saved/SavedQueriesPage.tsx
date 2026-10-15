import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, ChevronDown, ChevronUp, Copy, FolderOpen, Pencil, Search, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badges';
import { Button, Card, ErrorPanel, Input, Skeleton } from '@/components/ui/primitives';
import { SavedApi, kindLabel, useMe, useSavedSql, type SavedSql } from '@/lib/savedQueries';
import { openSavedQuery } from '@/lib/openSaved';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/store/toast';

type Scope = 'all' | 'mine' | 'shared';

/** The statement the query runs (builder queries: generated from the saved filters). */
function SqlPreview({ q }: { q: SavedSql }) {
  const r = useQuery({ queryKey: ['saved-sql-text', q.id, q.version], queryFn: () => SavedApi.sqlOf(q.id), retry: false, staleTime: 60_000 });
  return <pre className="mono max-h-56 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed">{r.isLoading ? 'Loading…' : r.isError ? `This query can no longer generate SQL: ${(r.error as Error).message}` : r.data!.inline}</pre>;
}

export default function SavedQueriesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useSavedSql();
  const me = useMe();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => (list.data ?? []).filter((q) => {
    if (scope === 'mine' && q.owner !== me.data) return false;
    if (scope === 'shared' && q.owner === me.data) return false;
    const t = search.trim().toLowerCase();
    return !t || `${q.name} ${q.description} ${q.sql} ${kindLabel(q)}`.toLowerCase().includes(t);
  }), [list.data, search, scope, me.data]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await qc.invalidateQueries({ queryKey: ['saved-sql'] }); toast.success(ok); } catch (e: any) { toast.error('Failed', e?.message); }
  };
  const openIt = (q: SavedSql) => openSavedQuery(q, navigate);
  const tab = (s: Scope, label: string) => <button onClick={() => setScope(s)} className={`rounded-[5px] px-3 py-1 text-xs font-medium ${scope === s ? 'bg-card text-foreground shadow-[0_0_0_1px_hsl(var(--border))]' : 'text-muted-foreground hover:text-foreground'}`} aria-pressed={scope === s}>{label}</button>;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-[34px] leading-none">Saved queries</h1>
        <p className="mt-2 text-xs text-muted-foreground">Everything you saved from Assets, Vulnerabilities and Custom SQL, plus what your team shared. Open one to edit it, or build charts from it on Canvas.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm"><Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, description or SQL…" aria-label="Search saved queries" className="pl-9" /></div>
        <div className="inline-flex rounded-md bg-muted p-0.5" role="group" aria-label="Filter">{tab('all', 'All')}{tab('mine', 'Mine')}{tab('shared', 'Shared with me')}</div>
        <Button className="ml-auto" variant="primary" onClick={() => navigate('/dashboard/sql')}>New query</Button>
      </div>

      {list.isError && <ErrorPanel message={(list.error as Error).message} onRetry={() => void list.refetch()} />}
      {list.isLoading ? <Skeleton className="h-48" /> : rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm">{(list.data?.length ?? 0) === 0 ? 'You have no saved queries yet.' : 'No queries match.'}</p>
          {(list.data?.length ?? 0) === 0 && <p className="mt-1 text-xs text-muted-foreground">Write a query on the Custom SQL page and press <b>Save query</b>.</p>}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-4 py-2.5 font-medium">Name</th><th className="px-3 py-2.5 font-medium">Type</th><th className="hidden px-3 py-2.5 font-medium md:table-cell">Description</th><th className="px-3 py-2.5 font-medium">Sharing</th><th className="px-3 py-2.5 font-medium">Version</th><th className="hidden px-3 py-2.5 font-medium lg:table-cell">Owner</th><th className="hidden px-3 py-2.5 font-medium lg:table-cell">Updated</th><th className="px-3 py-2.5 text-right font-medium">Actions</th></tr></thead>
            <tbody>
              {rows.map((q) => {
                const mine = q.owner === me.data;
                return (
                  <Fragment key={q.id}>
                    <tr className="border-b border-border/60 hover:bg-muted/40">
                      <td className="px-4 py-2.5"><div className="flex items-center gap-1">
                          <button className="text-left font-medium hover:underline" onClick={() => openIt(q)} title={q.kind === 'builder' ? 'Open with these filters applied' : 'Open in Custom SQL'}>{q.name}</button>
                          <button className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setOpen(open === q.id ? null : q.id)} aria-expanded={open === q.id} aria-label={`${open === q.id ? 'Hide' : 'Show'} SQL for ${q.name}`} title="Show the SQL">{open === q.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                        </div></td>
                      <td className="px-3 py-2.5"><Badge tone={q.kind === 'builder' ? 'primary' : 'neutral'}>{kindLabel(q)}</Badge></td>
                      <td className="hidden max-w-[22rem] truncate px-3 py-2.5 text-muted-foreground md:table-cell" title={q.description}>{q.description || '–'}</td>
                      <td className="px-3 py-2.5">{q.visibility === 'team' ? <Badge tone="primary">Team</Badge> : <Badge>Private</Badge>}</td>
                      <td className="num px-3 py-2.5">v{q.version}</td>
                      <td className="hidden px-3 py-2.5 text-muted-foreground lg:table-cell">{mine ? 'You' : q.owner}</td>
                      <td className="hidden px-3 py-2.5 text-muted-foreground lg:table-cell">{new Date(q.updated_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-0.5">
                          <Button size="sm" variant="ghost" onClick={() => openIt(q)} title="Open in Custom SQL"><FolderOpen size={14} /> Open</Button>
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/dashboard/canvas?build=${q.id}`)} title="Build a chart from this query"><BarChart3 size={14} /> Chart</Button>
                          <Button size="sm" variant="ghost" aria-label={`Duplicate ${q.name}`} title="Duplicate" onClick={() => void run(() => SavedApi.duplicate(q.id), 'Duplicated')}><Copy size={14} /></Button>
                          {mine && <>
                            <Button size="sm" variant="ghost" aria-label={`Rename ${q.name}`} title="Rename" onClick={() => { const n = window.prompt('Rename query', q.name); if (n?.trim()) void run(() => SavedApi.update(q.id, { name: n.trim() }), 'Renamed'); }}><Pencil size={14} /></Button>
                            <Button size="sm" variant="ghost" aria-label={q.visibility === 'team' ? 'Make private' : 'Share with team'} title={q.visibility === 'team' ? 'Make private' : 'Share with team'} onClick={() => void run(() => SavedApi.update(q.id, { visibility: q.visibility === 'team' ? 'private' : 'team' }), 'Sharing updated')}><Users size={14} /></Button>
                            <Button size="sm" variant="ghost" className="hover:text-sev-critical" aria-label={`Delete ${q.name}`} title="Delete" onClick={() => { if (window.confirm(`Delete “${q.name}”? Canvas tiles that use it will show an error.`)) void run(() => SavedApi.remove(q.id), 'Deleted'); }}><Trash2 size={14} /></Button>
                          </>}
                        </div>
                      </td>
                    </tr>
                    {open === q.id && <tr className="border-b border-border/60 bg-muted/30"><td colSpan={8} className="px-4 py-3"><SqlPreview q={q} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
