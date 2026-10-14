import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Copy, Play } from 'lucide-react';
import type { Entity } from '@shared/types';
import { Button } from '@/components/ui/primitives';
import { Api } from '@/lib/api';
import { cleanTree } from '@/lib/tree';
import { formatSql, inlineParams, tokenizeSql } from '@/lib/sql';
import { cn, useDebounced } from '@/lib/utils';
import { builderStore, effectiveColumns } from '@/store/builder';

const TONE = { kw: 'text-primary font-medium', ident: 'text-foreground', str: 'text-sev-medium', num: 'text-sev-low', text: 'text-muted-foreground' } as const;

export function SqlView({ sql, params, className }: { sql: string; params: Record<string, any>; className?: string }) {
  const text = useMemo(() => formatSql(inlineParams(sql, params)), [sql, params]);
  const parts = useMemo(() => tokenizeSql(text), [text]);
  return (
    <pre className={cn('mono max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-[12px] leading-relaxed', className)}>
      {parts.map((p, i) => <span key={i} className={TONE[p.t]}>{p.s}</span>)}
    </pre>
  );
}

/** The exact statement the builder will execute, with values filled in for readability. */
export function FinalSql({ entity, onRun }: { entity: Entity; onRun: () => void }) {
  const st = builderStore(entity)((x) => x);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const cols = effectiveColumns(st);
  const tree = useMemo(() => (st.meta ? cleanTree(st.tree, st.meta.fields) : st.tree), [st.tree, st.meta]);
  const key = useDebounced({ tree, cols, sort: st.sort, options: st.options, pageSize: st.pageSize, mode: st.mode, summary: st.summary }, 350);
  const q = useQuery({
    queryKey: ['sql-preview', entity, key],
    queryFn: () => (key.mode === 'summary' ? Api.preview({ mode: 'summary', entity, tree: key.tree, options: key.options, summary: key.summary }) : Api.preview({ entity, tree: key.tree, columns: key.cols, sort: key.sort, options: key.options, page: 0, pageSize: key.pageSize })),
    enabled: !!st.meta,
    retry: 0,
    placeholderData: (p) => p,
  });
  const plain = q.data ? formatSql(inlineParams(q.data.sql, q.data.params)) : '';
  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t); } }, [copied]);

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Final SQL
        </button>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" disabled={!plain} onClick={() => { void navigator.clipboard?.writeText(plain); setCopied(true); }}>{copied ? <Check size={13} /> : <Copy size={13} />} Copy</Button>
          <Button size="sm" variant="primary" onClick={onRun}><Play size={12} /> Execute</Button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border p-3">
          {q.data ? <SqlView sql={q.data.sql} params={q.data.params} className="border-0 p-0" /> : q.isError ? <p className="text-xs text-sev-critical">{(q.error as Error).message}</p> : <p className="text-xs text-muted-foreground">Building query…</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">Shown with values filled in for readability. It runs as a parameterized statement on your SQL warehouse; values are bound, never concatenated. Rows mode pages with LIMIT/OFFSET; Summary mode shows the top groups. Run it to get results and a CSV download.</p>
        </div>
      )}
    </div>
  );
}
