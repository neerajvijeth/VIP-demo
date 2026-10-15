import { NavLink, useNavigate } from 'react-router-dom';
import { Bookmark, ChevronsLeft, ChevronsRight, Copy, LayoutDashboard, Pencil, Server, ShieldAlert, Terminal, Trash2, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { SavedApi, useMe, useSavedSql } from '@/lib/savedQueries';
import { useCustomSql } from '@/store/customSql';
import { toast } from '@/store/toast';
import type { Entity } from '@shared/types';
import { cn, fmtCompact } from '@/lib/utils';
import { useTotalCount } from '@/lib/hooks';
import { useUi } from '@/store/ui';
import { useSaved } from '@/store/saved';
import { builderStore } from '@/store/builder';
import { ENTITY } from '@/lib/entities';
import { encodeHash } from '@/lib/tree';
import { Sheet } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/primitives';

function CountBadge({ entity }: { entity: Entity }) {
  const q = useTotalCount(entity);
  if (q.isLoading) return <Skeleton className="h-4 w-8" />;
  if (q.isError || !q.data) return null;
  return <span className="num text-[11px] text-muted-foreground" title={`${q.data.total.toLocaleString()} ${ENTITY[entity].label.toLowerCase()} (latest snapshot)`}>{fmtCompact(q.data.total)}</span>;
}

function SavedSqlList({ onNavigate }: { onNavigate?: () => void }) {
  const list = useSavedSql();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await qc.invalidateQueries({ queryKey: ['saved-sql'] }); toast.success(ok); } catch (e: any) { toast.error('Failed', e?.message); }
  };
  if (list.isError || !list.data?.length) return null;
  const btn = 'hidden rounded p-1 text-muted-foreground hover:text-foreground group-hover:block';
  return (
    <div className="mt-2">
      <div className="px-2.5 pb-0.5 text-[11px] text-muted-foreground/80">SQL queries</div>
      {list.data.map((q) => {
        const mine = q.owner === me.data;
        return (
          <div key={q.id} className="group flex items-center rounded-md hover:bg-muted">
            <button className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left text-sm text-muted-foreground group-hover:text-foreground" title={`${q.name} · v${q.version}${mine ? '' : ' · shared by ' + q.owner}`}
              onClick={() => { useCustomSql.getState().setSql(q.sql); navigate(`/dashboard/sql?q=${q.id}`); onNavigate?.(); }}>
              <span className="truncate">{q.name}</span>{q.visibility === 'team' && <Users size={11} className="shrink-0 opacity-60" aria-label="Shared" />}
            </button>
            <button className={btn} aria-label={`Duplicate ${q.name}`} title="Duplicate" onClick={() => void run(() => SavedApi.duplicate(q.id), 'Duplicated')}><Copy size={13} /></button>
            {mine && <>
              <button className={btn} aria-label={`Rename ${q.name}`} title="Rename" onClick={() => { const n = window.prompt('Rename query', q.name); if (n?.trim()) void run(() => SavedApi.update(q.id, { name: n.trim() }), 'Renamed'); }}><Pencil size={13} /></button>
              <button className={btn} aria-label={q.visibility === 'team' ? 'Make private' : 'Share with team'} title={q.visibility === 'team' ? 'Make private' : 'Share with team'} onClick={() => void run(() => SavedApi.update(q.id, { visibility: q.visibility === 'team' ? 'private' : 'team' }), 'Sharing updated')}><Users size={13} /></button>
              <button className={`${btn} hover:!text-sev-critical`} aria-label={`Delete ${q.name}`} title="Delete" onClick={() => { if (window.confirm(`Delete “${q.name}”?`)) void run(() => SavedApi.remove(q.id), 'Deleted'); }}><Trash2 size={13} /></button>
            </>}
          </div>
        );
      })}
    </div>
  );
}

function SidebarBody({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const items = [
    { to: '/dashboard/overview', label: 'Overview', icon: LayoutDashboard, entity: null as Entity | null },
    { to: '/dashboard/assets', label: 'Assets', icon: Server, entity: 'assets' as Entity },
    { to: '/dashboard/vulnerabilities', label: 'Vulnerabilities', icon: ShieldAlert, entity: 'vulnerabilities' as Entity },
    { to: '/dashboard/sql', label: 'Custom SQL', icon: Terminal, entity: null as Entity | null },
  ];
  const { views, remove } = useSaved();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      {items.map(({ to, label, icon: Icon, entity }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn('group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors duration-150', isActive ? 'bg-muted font-medium text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded before:bg-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground', collapsed && 'justify-center')
          }
        >
          <Icon size={17} strokeWidth={1.6} className="shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{label}</span>}
          {!collapsed && entity && <CountBadge entity={entity} />}
        </NavLink>
      ))}

      {!collapsed && (
        <div className="mt-4">
          <div className="eyebrow flex items-center gap-2 px-2.5 pb-1">
            <Bookmark size={12} /> Saved views
          </div>
          {views.length === 0 && <p className="px-2.5 py-1 text-xs text-muted-foreground/80">Save a query from the Assets, Vulnerabilities or Custom SQL page.</p>}
          {(['assets', 'vulnerabilities'] as Entity[]).map((e) => {
            const list = views.filter((v) => v.entity === e);
            if (!list.length) return null;
            return (
              <div key={e} className="mt-2">
                <div className="px-2.5 pb-0.5 text-[11px] text-muted-foreground/80">{ENTITY[e].label}</div>
                {list.map((v) => (
                  <div key={v.id} className="group flex items-center rounded-md hover:bg-muted">
                    <button
                      className="flex-1 truncate px-2.5 py-1.5 text-left text-sm text-muted-foreground group-hover:text-foreground"
                      onClick={() => {
                        builderStore(e).getState().loadView(v);
                        navigate(ENTITY[e].path + encodeHash(v.tree, v.options, v.mode === 'summary' ? v.summary : null));
                        onNavigate?.();
                      }}
                      title={v.name}
                    >
                      {v.name}
                    </button>
                    <button className="mr-1 hidden rounded p-1 text-muted-foreground hover:text-sev-critical group-hover:block" aria-label={`Delete saved view ${v.name}`} onClick={() => remove(v.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
          <SavedSqlList onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNav } = useUi();
  return (
    <>
      <aside className={cn('no-print hidden shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 lg:flex', sidebarCollapsed ? 'w-[60px]' : 'w-60')} aria-label="Dashboard navigation">
        <div className="min-h-0 flex-1">
          <SidebarBody collapsed={sidebarCollapsed} />
        </div>
        <button onClick={toggleSidebar} className="m-2 flex items-center justify-center gap-2 rounded-md p-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {sidebarCollapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> Collapse</>}
        </button>
      </aside>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNav} title="Navigation" side="left" width="max-w-[17rem]">
        <SidebarBody collapsed={false} onNavigate={() => setMobileNav(false)} />
      </Sheet>
    </>
  );
}
