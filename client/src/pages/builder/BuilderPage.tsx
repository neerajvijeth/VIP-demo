import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Eraser, Loader2, Play, Sparkles, TriangleAlert } from 'lucide-react';
import type { Entity } from '@shared/types';
import { Badge } from '@/components/ui/badges';
import { Button, Card, ErrorPanel, Kbd, Segmented, Skeleton, Switch } from '@/components/ui/primitives';
import { SummaryEditor } from '@/components/summary/SummaryEditor';
import { SummaryResult } from '@/components/summary/SummaryResult';
import { drillConditions } from '@/lib/summary';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import { Api } from '@/lib/api';
import { ENTITY } from '@/lib/entities';
import { useFields, useOpenBuilder } from '@/lib/hooks';
import { L } from '@shared/semantics';
import { getPresets, presetAvailable, cleanTree, countConditions, countIncomplete, decodeHash, encodeHash, treeText, treeTokens, type Tok } from '@/lib/tree';
import { fmtNum, useDebounced } from '@/lib/utils';
import { builderStore, effectiveColumns } from '@/store/builder';
import { QueryBuilder } from './QueryBuilder';
import { ColumnsEditor } from './ColumnsEditor';
import { ResultsTable } from './ResultsTable';
import { DetailDrawer } from './DetailDrawer';
import { FinalSql } from './FinalSql';
import { SelectedColumns } from './SelectedColumns';
import { RefreshCw } from 'lucide-react';
import { SavedQueriesMenu, SaveQueryButton } from './SavedQueriesMenu';

const TOK_CLS: Record<Tok['k'], string> = { field: 'text-primary font-medium', op: 'text-muted-foreground', val: 'text-sev-medium', kw: 'text-foreground font-semibold', punct: 'text-sev-critical font-semibold' };

export function BuilderPage({ entity }: { entity: Entity }) {
  const meta = ENTITY[entity];
  const useStore = builderStore(entity);
  const st = useStore((s) => s);
  const { fields, columns, map, columnMap, isLoading, isError, error, refetch, data: fieldsData } = useFields(entity);
  const open = useOpenBuilder();
  const [refreshing, setRefreshing] = useState(false);
  const envQ = useQuery({ queryKey: ['env'], queryFn: Api.env, staleTime: Infinity });

  // --- URL hash ⇄ builder tree (shareable views) ---
  useState(() => {
    const decoded = decodeHash(window.location.hash);
    if (decoded && encodeHash(useStore.getState().tree, undefined, useStore.getState().mode === 'summary' ? useStore.getState().summary : null) !== encodeHash(decoded.tree, undefined, decoded.summary)) useStore.getState().openWith(decoded.tree, decoded.options, true, decoded.summary ?? null);
    return null;
  });
  const hash = useMemo(() => encodeHash(st.tree, st.options, st.mode === 'summary' ? st.summary : null), [st.tree, st.options, st.mode, st.summary]);
  const debouncedHash = useDebounced(hash, 300);
  useEffect(() => {
    const url = window.location.pathname + window.location.search + debouncedHash;
    window.history.replaceState(window.history.state, '', url);
  }, [debouncedHash]);

  // --- run once metadata is ready (e.g. after a drill-down from Overview) ---
  useEffect(() => {
    if (st.pendingRun && st.meta) st.run();
  }, [st.pendingRun, st.meta]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Ctrl/Cmd+Enter ---
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        useStore.getState().run();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [useStore]);

  const cleaned = useMemo(() => cleanTree(st.tree, map), [st.tree, map]);
  const nConds = countConditions(cleaned);
  const incomplete = countIncomplete(st.tree, map);
  const debTree = useDebounced(cleaned, 600);
  const debOpts = useDebounced(st.options, 600);
  const count = useQuery({
    queryKey: ['count', entity, debTree, debOpts],
    queryFn: ({ signal }) => Api.count(entity, debTree, debOpts, signal),
    enabled: !!st.meta,
    staleTime: 60_000,
    retry: 0,
    placeholderData: (prev) => prev,
  });
  const settling = debTree !== cleaned || debOpts !== st.options;
  const tokens = useMemo(() => treeTokens(cleaned, map), [cleaned, map]);
  const summary = treeText(cleaned, map) || 'No filters — all records';
  const presets = getPresets().filter((p) => p.entity === entity && presetAvailable(p, map));
  const onSummarySort = (by: string) => {
    const cur = st.summary.sort ?? { by: 'metric_1', dir: 'desc' as const };
    st.setSummary({ ...st.summary, sort: { by, dir: cur.by === by && cur.dir === 'desc' ? 'asc' : cur.by === by ? 'desc' : by.startsWith('metric') ? 'desc' : 'asc' } });
    st.run();
  };
  const onDrill = (row: Record<string, any>) => {
    const conds = drillConditions(st.summary, row, map);
    const base = cleaned.children.length ? [{ ...cleaned, id: undefined } as any] : [];
    open(entity, { type: 'group', op: 'AND', not: false, children: [...base, ...conds] }, st.options, null);
  };
  const refreshSchema = async () => {
    setRefreshing(true);
    try {
      await Api.refreshSchema();
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[34px] leading-none">{meta.label}</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Query <span className="mono">{entity === 'assets' ? 'gold_assets' : 'gold_vulnerabilities'}</span> live on the SQL warehouse.
            {count.data && <> <b className="num text-foreground">{fmtNum(count.data.total)}</b> matching now.</>}
            {fieldsData && <> Schema discovered from the warehouse: <b className="num text-foreground">{fieldsData.columns.length}</b> columns, <b className="num text-foreground">{fields.length}</b> filterable.
              <button className="ml-1.5 inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50" onClick={() => void refreshSchema()} disabled={refreshing}><RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /> Refresh</button></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild><Button size="sm"><Sparkles size={14} /> Quick filters</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1.5">
              {presets.map((p) => (
                <button key={p.id} className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-muted" onClick={() => open(entity, p.tree, undefined, p.summary)}>
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <SavedQueriesMenu entity={entity} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Scope">
        <Switch disabled={fieldsData?.scope.snapshot === false} checked={st.options.latestSnapshotOnly} onChange={(b) => st.setOptions({ latestSnapshotOnly: b })} label="Latest snapshot only" title={`${L('snapshot_date')} = MAX(${L('snapshot_date')})`} />
        {st.options.latestSnapshotOnly && fieldsData?.scope.snapshot !== false && <Badge tone="primary">snapshot = latest</Badge>}
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => st.setBuilderOpen(!st.builderOpen)} aria-expanded={st.builderOpen}>
            {st.builderOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            <span className="font-display text-[20px] leading-none">Query builder</span>
            {!st.builderOpen && <span className="mono truncate text-xs text-muted-foreground" title={summary}>{summary}</span>}
          </button>
          {!st.builderOpen && <Button size="sm" variant="primary" onClick={() => st.run()}><Play size={13} /> Run</Button>}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{nConds} condition{nConds === 1 ? '' : 's'}</span>
            {incomplete > 0 && <Badge tone="medium" title="Incomplete conditions are ignored"><TriangleAlert size={11} /> {incomplete} incomplete</Badge>}
          </div>
        </div>

        {st.builderOpen && (
          <div className="space-y-3 p-4">
            {isLoading ? (
              <Skeleton className="h-32" />
            ) : isError ? (
              <ErrorPanel message={(error as Error).message} onRetry={() => void refetch()} />
            ) : (
              <QueryBuilder entity={entity} fields={fields} map={map} />
            )}

            <div className="rounded-md border border-border bg-background/50 p-3" aria-label="Query preview">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Readable query</span>
              </div>
              <p className="mono break-words text-[13px] leading-relaxed">
                {tokens.length ? tokens.map((t, i) => <span key={i} className={TOK_CLS[t.k]}>{t.s}</span>) : <span className="text-muted-foreground">No filters — every record matches.</span>}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">Result type</span>
              <Segmented ariaLabel="Result type" value={st.mode} onChange={(m) => st.setMode(m)} options={[{ value: 'rows', label: 'Rows', title: 'List the matching records' }, { value: 'summary', label: 'Summary', title: 'Count or total per group, e.g. assets per business unit' }]} />
              <span className="text-xs text-muted-foreground">{st.mode === 'rows' ? 'List the matching records.' : 'Count or total things per group, e.g. assets per business unit.'}</span>
            </div>

            {st.mode === 'rows' ? <SelectedColumns entity={entity} columns={columns} columnMap={columnMap} /> : <div className="rounded-md border border-border p-3"><SummaryEditor entity={entity} fields={fields} spec={st.summary} onChange={st.setSummary} /></div>}

            <FinalSql entity={entity} onRun={() => st.run()} />

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => st.run()} aria-label="Run query">
                <Play size={14} /> Run query <span className="ml-1 hidden sm:inline"><Kbd>Ctrl ⏎</Kbd></span>
              </Button>
              <SaveQueryButton entity={entity} disabled={!st.ran && !st.ranSummary} />
              <div className="flex min-w-[8rem] items-center gap-2 text-sm" aria-live="polite">
                {count.isFetching || settling ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : null}
                {count.data ? <span><b className="num">{fmtNum(count.data.total)}</b> <span className="text-muted-foreground">matching</span></span> : count.isError ? <span className="text-xs text-sev-critical" title={(count.error as Error).message}>count unavailable</span> : null}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => st.clearTree()}><Eraser size={14} /> Clear</Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {!st.builderOpen && st.mode === 'rows' && (
        <div className="flex justify-end"><ColumnsEditor entity={entity} columns={columns} /></div>
      )}

      {st.mode === 'rows' ? (
        <ResultsTable entity={entity} columnMap={columnMap} />
      ) : (
        <Card className="p-4">
          <SummaryResult req={st.ranSummary} spec={st.ranSummary?.summary ?? st.summary} onSort={onSummarySort} onDrill={onDrill} exportCap={envQ.data?.exportMaxRows} fieldMap={map} />
        </Card>
      )}
      <DetailDrawer entity={entity} />
    </div>
  );
}
