import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Download, Rows3, Search } from 'lucide-react';
import type { Entity, FieldDef } from '@shared/types';
import { Button, Card, ErrorPanel, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { Api, ApiError } from '@/lib/api';
import { ENTITY } from '@/lib/entities';
import { exportCsv } from '@/lib/export';
import { cn, fmtNum, fmtSecs } from '@/lib/utils';
import { builderStore, effectiveColumns } from '@/store/builder';
import { renderCell } from './cells';
import { L } from '@shared/semantics';
import { SqlView } from './FinalSql';


const PAGE_SIZES = [25, 50, 100, 250];
/** Stable reference: a fresh [] each render makes TanStack Table reset state and re-render forever. */
const NO_ROWS: Record<string, any>[] = [];

export function ResultsTable({ entity, columnMap }: { entity: Entity; columnMap: Map<string, FieldDef> }) {
  const s = builderStore(entity);
  const st = s((x) => x);
  const { ran, sort, density } = st;
  const shown = effectiveColumns(st);
  const env = useQuery({ queryKey: ['env'], queryFn: Api.env, staleTime: Infinity });

  const q = useQuery({
    queryKey: ['run', ran],
    queryFn: ({ signal }) => Api.run(ran!, signal),
    enabled: !!ran,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });
  const data = q.data;
  const [showSql, setShowSql] = useState(false);
  const rowH = density === 'compact' ? 30 : 40;

  const visible = useMemo(() => shown.filter((c) => !data || data.columns.includes(c)), [shown, data]);
  const columns = useMemo<ColumnDef<Record<string, any>>[]>(
    () =>
      visible.map((key) => {
        const f = columnMap.get(key);
        return {
          id: key,
          accessorKey: key,
          header: f?.label ?? key,
          size: ['hostname', 'vulnerability_name', 'title', 'os_name', 'fqdn', 'solution', 'remediation_recommendation'].includes(key) ? 240 : f?.type === 'date' ? 160 : 150,
          minSize: 70,
          cell: (ctx) => renderCell(key, ctx.getValue(), f?.type),
        };
      }),
    [visible, columnMap],
  );
  const rows = data?.rows ?? NO_ROWS;
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), columnResizeMode: 'onChange', enableColumnResizing: true, manualSorting: true, manualPagination: true, autoResetAll: false });

  const scrollRef = useRef<HTMLDivElement>(null);
  const model = table.getRowModel().rows;
  const virt = useVirtualizer({ count: model.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12 });

  const cycleSort = (key: string) => {
    if (sort?.field !== key) st.setSort({ field: key, dir: 'asc' });
    else if (sort.dir === 'asc') st.setSort({ field: key, dir: 'desc' });
    else st.setSort(null);
  };

  if (!ran) {
    return (
      <Card className="grid place-items-center px-6 py-14 text-center">
        <Search size={28} className="mb-3 text-muted-foreground" />
        <p className="text-sm font-medium">Build a query and press Run</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">Results load only when you run the query (<kbd className="mono">Ctrl</kbd>+<kbd className="mono">Enter</kbd>). An empty builder runs against everything, paginated.</p>
      </Card>
    );
  }

  const total = data?.total ?? 0;
  const pageSize = ran.pageSize;
  const page = ran.page;
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="text-sm" aria-live="polite">
          {data ? (
            <>Showing <b className="num">{fmtNum(from)}-{fmtNum(to)}</b> of <b className="num">{fmtNum(total)}</b> <span className="text-muted-foreground">· query ran in {fmtSecs(data.elapsedMs)}</span></>
          ) : q.isError ? <span className="text-sev-critical">Query failed</span> : <span className="text-muted-foreground">Running query…</span>}
          {q.isFetching && data && <span className="ml-2 text-xs text-primary">updating…</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowSql((v) => !v)} disabled={!data} aria-pressed={showSql}>{showSql ? 'Hide SQL' : 'View executed SQL'}</Button>
          <Button size="sm" variant="ghost" onClick={() => st.setDensity(density === 'compact' ? 'comfortable' : 'compact')} aria-label="Toggle row density" title="Toggle row density"><Rows3 size={14} /> {density === 'compact' ? 'Compact' : 'Comfortable'}</Button>
          <Button
            size="sm"
            disabled={!data || total === 0}
            onClick={() => exportCsv({ entity, tree: ran.tree, columns: shown, sort: ran.sort, options: ran.options }, total, env.data?.exportMaxRows ?? 1_000_000)}
            title="Exports ALL matching rows with the current columns and sort"
          >
            <Download size={14} /> Download CSV
          </Button>
        </div>
      </div>

      {showSql && data && <div className="border-b border-border bg-muted/30 p-3"><div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Executed statement</div><SqlView sql={data.sql} params={data.params} /></div>}

      {q.isError && !data ? (
        <div className="p-4"><ErrorPanel message={(q.error as Error).message} detail={(q.error as ApiError).detail ?? (q.error as Error).message} onRetry={() => void q.refetch()} /></div>
      ) : q.isPending ? (
        <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-14 text-center text-sm text-muted-foreground">No rows match this query.</div>
      ) : (
        <div ref={scrollRef} className={cn('overflow-auto', q.isFetching && 'opacity-70 transition-opacity')} style={{ maxHeight: 'min(70vh, 720px)' }} role="table" aria-rowcount={total} aria-label={`${ENTITY[entity].label} results`}>
          <div style={{ width: Math.max(table.getTotalSize(), 1) }} className="min-w-full">
            {table.getHeaderGroups().map((hg) => (
              <div key={hg.id} role="row" className="sticky top-0 z-10 flex border-b border-border bg-card">
                {hg.headers.map((h) => {
                  const active = sort?.field === h.column.id;
                  return (
                    <div key={h.id} role="columnheader" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="relative flex shrink-0 items-center px-3 text-left text-xs font-semibold text-muted-foreground" style={{ width: h.getSize(), height: 36 }}>
                      <button className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground" onClick={() => cycleSort(h.column.id)} title="Click to sort (server-side)">
                        <span className="truncate">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                        {active ? (sort!.dir === 'asc' ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />) : <ChevronsUpDown size={12} className="opacity-40" />}
                      </button>
                      <div
                        onMouseDown={h.getResizeHandler()}
                        onTouchStart={h.getResizeHandler()}
                        onDoubleClick={() => h.column.resetSize()}
                        role="separator"
                        aria-label="Resize column"
                        className={cn('absolute right-0 top-1.5 h-5 w-1.5 cursor-col-resize touch-none select-none rounded bg-border hover:bg-primary', h.column.getIsResizing() && 'bg-primary')}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
              {virt.getVirtualItems().map((vi) => {
                const row = model[vi.index];
                return (
                  <div
                    key={row.id}
                    role="row"
                    tabIndex={0}
                    onClick={() => st.setDetail({ key: String(row.original[ENTITY[entity].key]), snapshot: row.original[L('snapshot_date')] ? String(row.original[L('snapshot_date')]).slice(0, 10) : undefined })}
                    onKeyDown={(e) => e.key === 'Enter' && st.setDetail({ key: String(row.original[ENTITY[entity].key]), snapshot: row.original[L('snapshot_date')] ? String(row.original[L('snapshot_date')]).slice(0, 10) : undefined })}
                    className="absolute left-0 flex cursor-pointer items-center border-b border-border/60 text-sm hover:bg-primary/5 focus-visible:bg-primary/10"
                    style={{ top: 0, height: rowH, transform: `translateY(${vi.start}px)`, width: '100%' }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div key={cell.id} role="cell" className="shrink-0 truncate px-3" style={{ width: cell.column.getSize() }} title={typeof cell.getValue() === 'string' ? (cell.getValue() as string) : undefined}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs">
        <label className="flex items-center gap-2 text-muted-foreground">
          Rows per page
          <NativeSelect className="h-8" value={pageSize} onChange={(e) => st.setPageSize(Number(e.target.value))} aria-label="Rows per page">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </NativeSelect>
        </label>
        <div className="flex items-center gap-2">
          <span className="num text-muted-foreground">Page {fmtNum(page + 1)} of {fmtNum(lastPage + 1)}</span>
          <Button size="iconSm" variant="outline" disabled={page === 0 || q.isFetching} onClick={() => st.setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></Button>
          <Button size="iconSm" variant="outline" disabled={page >= lastPage || q.isFetching} onClick={() => st.setPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></Button>
        </div>
      </div>
    </Card>
  );
}
