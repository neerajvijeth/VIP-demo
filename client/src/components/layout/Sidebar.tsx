import { NavLink } from 'react-router-dom';
import { BookmarkCheck, ChevronsLeft, ChevronsRight, LayoutDashboard, LayoutGrid, Server, ShieldAlert, Terminal } from 'lucide-react';
import type { Entity } from '@shared/types';
import { cn, fmtCompact } from '@/lib/utils';
import { useTotalCount } from '@/lib/hooks';
import { useUi } from '@/store/ui';
import { ENTITY } from '@/lib/entities';
import { Sheet } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/primitives';

function CountBadge({ entity }: { entity: Entity }) {
  const q = useTotalCount(entity);
  if (q.isLoading) return <Skeleton className="h-4 w-8" />;
  if (q.isError || !q.data) return null;
  return <span className="num text-[11px] text-muted-foreground" title={`${q.data.total.toLocaleString()} ${ENTITY[entity].label.toLowerCase()} (latest snapshot)`}>{fmtCompact(q.data.total)}</span>;
}

function SidebarBody({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const items = [
    { to: '/dashboard/overview', label: 'Overview', icon: LayoutDashboard, entity: null as Entity | null },
    { to: '/dashboard/assets', label: 'Assets', icon: Server, entity: 'assets' as Entity },
    { to: '/dashboard/vulnerabilities', label: 'Vulnerabilities', icon: ShieldAlert, entity: 'vulnerabilities' as Entity },
    { to: '/dashboard/sql', label: 'Custom SQL', icon: Terminal, entity: null as Entity | null },
    { to: '/dashboard/saved', label: 'Saved queries', icon: BookmarkCheck, entity: null as Entity | null },
    { to: '/dashboard/canvas', label: 'Canvas', icon: LayoutGrid, entity: null as Entity | null },
  ];

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
