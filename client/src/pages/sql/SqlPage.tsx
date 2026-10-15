import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Save } from 'lucide-react';
import { Modal } from '@/components/ui/overlay';
import { SavedApi, useMe, type SavedSql } from '@/lib/savedQueries';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BookOpen, ChevronDown, ChevronRight, Clock, Copy, Download, Eraser, Loader2, Play, ShieldCheck, Square } from 'lucide-react';
import { Button, Card, Input, NativeSelect } from '@/components/ui/primitives';
import { Api } from '@/lib/api';
import { exportCsv } from '@/lib/export';
import { fmtNum, fmtSecs } from '@/lib/utils';
import { useCustomSql } from '@/store/customSql';
import { toast } from '@/store/toast';
import { makeExamples, tableNames } from './examples';
import { L, semantics } from '@shared/semantics';

function Grid({ columns, rows }: { columns: string[]; rows: Record<string, any>[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => 32, overscan: 15 });
  const widths = useMemo(() => columns.map((c) => Math.min(320, Math.max(110, c.length * 9 + 40))), [columns]);
  const total = widths.reduce((a, b) => a + b, 0);
  const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v)) ? String(v).slice(0, 19).replace('T', ' ') : String(v));
  return (
    <div ref={ref} className="overflow-auto rounded-md border border-border" style={{ maxHeight: 'min(62vh, 640px)' }} role="table" aria-rowcount={rows.length}>
      <div style={{ width: Math.max(total, 1) }} className="min-w-full">
        <div role="row" className="sticky top-0 z-10 flex border-b border-border bg-card">
          {columns.map((c, i) => <div key={c + i} role="columnheader" className="mono shrink-0 truncate px-3 py-2 text-xs font-medium text-muted-foreground" style={{ width: widths[i] }} title={c}>{c}</div>)}
        </div>
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((vi) => (
            <div key={vi.index} role="row" className="absolute left-0 flex w-full items-center border-b border-border/60 text-[13px] hover:bg-muted/50" style={{ height: 32, transform: `translateY(${vi.start}px)` }}>
              {columns.map((c, i) => {
                const v = rows[vi.index][c];
                return <div key={c + i} role="cell" className={`shrink-0 truncate px-3 ${typeof v === 'number' ? 'num text-right' : ''}`} style={{ width: widths[i] }} title={show(v)}>{v === null || v === undefined ? <span className="text-muted-foreground/50">null</span> : show(v)}</div>;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SchemaPanel({ onInsert, catalog, schema }: { onInsert: (t: string) => void; catalog: string; schema: string }) {
  const assets = useQuery({ queryKey: ['fields', 'assets'], queryFn: () => Api.fields('assets'), staleTime: Infinity });
  const vulns = useQuery({ queryKey: ['fields', 'vulnerabilities'], queryFn: () => Api.fields('vulnerabilities'), staleTime: Infinity });
  const TABLES = tableNames();
  const [open, setOpen] = useState<string | null>(TABLES[0]);
  const [q, setQ] = useState('');
  const t = semantics().tables;
  const cols: Record<string, { key: string; type: string }[]> = {
    [t.assets]: (assets.data?.columns ?? []).map((c) => ({ key: c.key, type: c.type })),
    [t.vulnerabilities]: (vulns.data?.columns ?? []).map((c) => ({ key: c.key, type: c.type })),
    [t.kpi]: ['metric_name', 'metric_value', 'snapshot_date'].map((k) => ({ key: L(k), type: k === 'metric_value' ? 'number' : k === 'snapshot_date' ? 'date' : 'string' })),
  };
  return (
    <div>
      <div className="eyebrow mb-2">Tables and columns</div>
      <Input placeholder="Filter columns…" aria-label="Filter columns" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2 h-8" />
      <ul className="space-y-1">
        {TABLES.map((t) => {
          const list = (cols[t] ?? []).filter((c) => !q || c.key.includes(q.toLowerCase()));
          const expanded = open === t || !!q;
          return (
            <li key={t}>
              <div className="flex items-center gap-1">
                <button className="rounded p-0.5 text-muted-foreground hover:bg-muted" onClick={() => setOpen(open === t ? null : t)} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${t}`}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                <button className="mono flex-1 truncate rounded px-1.5 py-1 text-left text-[12px] hover:bg-muted" title="Insert the full table name" onClick={() => onInsert(`${catalog}.${schema}.${t}`)}>{t}</button>
                <span className="num text-[11px] text-muted-foreground">{cols[t]?.length || ''}</span>
              </div>
              {expanded && (
                <ul className="ml-5 mt-0.5 max-h-56 overflow-auto border-l border-border pl-2">
                  {list.map((c) => (
                    <li key={c.key}><button className="mono flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-[11.5px] hover:bg-muted" onClick={() => onInsert(c.key)} title="Insert column name"><span className="truncate">{c.key}</span><span className="shrink-0 text-[10px] text-muted-foreground">{c.type}</span></button></li>
                  ))}
                  {list.length === 0 && <li className="px-1.5 py-1 text-xs text-muted-foreground">{assets.isLoading || vulns.isLoading ? 'Loading…' : 'No columns'}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function SqlPage() {
  const { sql, setSql, maxRows, setMaxRows, run, cancel, running, result, error, history, clearHistory } = useCustomSql();
  const env = useQuery({ queryKey: ['env'], queryFn: Api.env, staleTime: Infinity });
  const area = useRef<HTMLTextAreaElement>(null);
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const me = useMe();
  const [loaded, setLoaded] = useState<SavedSql | null>(null);
  const [versions, setVersions] = useState<{ version: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' });
  const qid = sp.get('q');
  const refresh = () => qc.invalidateQueries({ queryKey: ['saved-sql'] });
  useEffect(() => {
    if (!qid) { setLoaded(null); return; }
    SavedApi.list().then((l) => { const q = l.find((x) => x.id === qid); if (q) { setLoaded(q); setSql(q.sql); SavedApi.versions(q.id).then(setVersions).catch(() => undefined); } }).catch((e) => toast.error('Could not open the saved query', e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qid]);
  const mine = !!loaded && loaded.owner === me.data;
  const saveNew = async () => {
    try { const q = await SavedApi.create({ ...form, sql }); await refresh(); setSaving(false); setSp({ q: q.id }); toast.success('Query saved', `“${q.name}” is in Saved views.`); } catch (e: any) { toast.error('Could not save', e.message); }
  };
  const updateSaved = async () => {
    if (!loaded) return;
    try { const q = await SavedApi.update(loaded.id, { sql }); setLoaded(q); setVersions(await SavedApi.versions(q.id)); await refresh(); toast.success(q.version === loaded.version ? 'No changes to save' : `Saved as v${q.version}`); } catch (e: any) { toast.error('Could not update', e.message); }
  };
  const rollbackTo = async (v: number) => {
    if (!loaded) return;
    try { const q = await SavedApi.rollback(loaded.id, v); setLoaded(q); setSql(q.sql); setVersions(await SavedApi.versions(q.id)); await refresh(); toast.success(`Restored v${v} as v${q.version}`); } catch (e: any) { toast.error('Could not roll back', e.message); }
  };
  const catalog = env.data?.catalog ?? 'workspace';
  const schema = env.data?.schema ?? 'default';
  const examples = makeExamples(catalog, schema);

  const insert = (text: string) => {
    const el = area.current;
    if (!el) return setSql(sql + text);
    const { selectionStart: a, selectionEnd: b } = el;
    setSql(sql.slice(0, a) + text + sql.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + text.length, a + text.length); });
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run(); }
    else if (e.key === 'Tab') { e.preventDefault(); insert('  '); }
  };
  const download = () => {
    if (!result) return;
    void exportCsv({ sql: result.sql }, result.truncated ? result.maxRows + 1 : result.rows.length, env.data?.exportMaxRows ?? 1_000_000, { url: '/api/custom/export', prefix: 'custom_query' });
  };

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-[34px] leading-none">Custom SQL</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <ShieldCheck size={13} /> Read-only. SELECT, WITH, DESCRIBE, SHOW and EXPLAIN only, one statement at a time. Runs on the SQL warehouse with the app's access rights.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="eyebrow">Query</span>
                <NativeSelect className="h-8 text-xs" value="" onChange={(e) => { const ex = examples[Number(e.target.value)]; if (ex) setSql(ex.sql); }} aria-label="Load an example">
                  <option value="">Examples…</option>
                  {examples.map((ex, i) => <option key={ex.title} value={i}>{ex.title}</option>)}
                </NativeSelect>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(sql); toast.info('SQL copied'); }} disabled={!sql}><Copy size={13} /> Copy</Button>
                <Button size="sm" variant="ghost" onClick={() => setSql('')} disabled={!sql}><Eraser size={13} /> Clear</Button>
                {loaded && mine && <Button size="sm" variant="ghost" onClick={() => void updateSaved()} disabled={!sql.trim()}><Save size={13} /> Update “{loaded.name}” (v{loaded.version})</Button>}
                {loaded && mine && versions.length > 1 && (
                  <NativeSelect className="h-8 text-xs" value="" aria-label="Restore a version" onChange={(e) => e.target.value && void rollbackTo(Number(e.target.value))}>
                    <option value="">Versions…</option>
                    {versions.filter((v) => v.version !== loaded.version).map((v) => <option key={v.version} value={v.version}>Restore v{v.version}</option>)}
                  </NativeSelect>
                )}
                <Button size="sm" variant="ghost" onClick={() => { setForm({ name: loaded ? `${loaded.name} (copy)` : '', description: '', visibility: 'private' }); setSaving(true); }} disabled={!sql.trim()}><BookmarkPlus size={13} /> Save query</Button>
              </div>
            </div>
            <textarea
              ref={area}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="SQL editor"
              placeholder={examples[0].sql}
              className="mono block min-h-[14rem] w-full resize-y bg-background px-4 py-3 text-[13px] leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5">
              {running ? (
                <Button variant="secondary" onClick={cancel}><Square size={12} /> Cancel</Button>
              ) : (
                <Button variant="primary" onClick={() => void run()} disabled={!sql.trim()}><Play size={13} /> Run <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">Ctrl ⏎</span></Button>
              )}
              {running && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Running on the warehouse… the first query after a pause can take a while</span>}
              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                Show up to
                <NativeSelect className="h-8 text-xs" value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))} aria-label="Maximum rows to display">
                  {[100, 1000, 5000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
                </NativeSelect>
                rows
              </div>
            </div>
          </Card>

          {error && (
            <div role="alert" className="rounded-lg border border-sev-critical/30 bg-sev-critical/10 px-4 py-3">
              <div className="text-sm font-medium text-sev-critical">{error.message === 'Query failed' && error.detail ? 'Query failed' : error.message === 'Cancelled' ? 'Cancelled' : 'Could not run this statement'}</div>
              {error.message !== 'Cancelled' && <pre className="mono mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed">{error.detail && error.message === 'Query failed' ? error.detail : error.message}</pre>}
            </div>
          )}

          {result && (
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-live="polite">
                <span>
                  <b className="num">{fmtNum(result.rows.length)}</b> row{result.rows.length === 1 ? '' : 's'}{result.truncated ? ' shown (more available)' : ''} · <b className="num">{result.columns.length}</b> column{result.columns.length === 1 ? '' : 's'}
                  <span className="text-muted-foreground"> · ran in {fmtSecs(result.elapsedMs)}</span>
                </span>
                <span className="flex items-center gap-3">
                  {result.truncated && <span className="text-xs text-sev-medium">Display is capped at {fmtNum(result.maxRows)} rows. CSV exports everything.</span>}
                  <Button size="sm" onClick={download} disabled={result.columns.length === 0} title="Re-runs this query and streams every row to a CSV file"><Download size={13} /> Download CSV</Button>
                </span>
              </div>
              {result.columns.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">The statement ran but returned no columns.</p> : result.rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No rows returned.</p> : <Grid columns={result.columns} rows={result.rows} />}
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <Card className="p-4"><SchemaPanel onInsert={insert} catalog={catalog} schema={schema} /></Card>
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow flex items-center gap-1.5"><Clock size={12} /> Recent</span>
              {history.length > 0 && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={clearHistory}>Clear</button>}
            </div>
            {history.length === 0 ? <p className="text-xs text-muted-foreground">Queries you run appear here.</p> : (
              <ul className="space-y-1">
                {history.map((h) => (
                  <li key={h.at}><button className="mono block w-full truncate rounded px-2 py-1 text-left text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground" title={h.sql} onClick={() => setSql(h.sql)}>{h.sql.replace(/\s+/g, ' ')}</button></li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4 text-xs text-muted-foreground">
            <div className="eyebrow mb-1.5 flex items-center gap-1.5"><BookOpen size={12} /> Good to know</div>
            <ul className="list-disc space-y-1 pl-4">
              <li>Tables hold many daily snapshots. Add <span className="mono">{L('snapshot_date')} = (SELECT MAX({L('snapshot_date')}) …)</span> for the latest state.</li>
              <li>Name your columns (<span className="mono">AS total</span>): duplicate column names collapse into one.</li>
              <li>Dates show as UTC.</li>
            </ul>
          </Card>
        </aside>
      </div>
      <Modal open={saving} onOpenChange={setSaving} title="Save query">
        <div className="space-y-3">
          <label className="block text-xs font-medium">Name<Input autoFocus className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} placeholder="e.g. Servers with open KEV findings" /></label>
          <label className="block text-xs font-medium">Description<Input className="mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" /></label>
          <label className="block text-xs font-medium">Visibility<NativeSelect className="mt-1 w-full" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="private">Private (only me)</option><option value="team">Team (everyone can open it)</option></NativeSelect></label>
          <p className="text-[11px] text-muted-foreground">Read-only SQL only. The same safety checks as the Run button apply when saving.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSaving(false)}>Cancel</Button><Button variant="primary" disabled={!form.name.trim()} onClick={() => void saveNew()}>Save</Button></div>
        </div>
      </Modal>
    </div>
  );
}
