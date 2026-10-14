import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, Moon, Search, Sun } from 'lucide-react';
import { Button, Kbd } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Api } from '@/lib/api';
import { useRefreshed } from '@/lib/hooks';
import { useUi } from '@/store/ui';

export function useMode(): 'dashboard' | 'chat' {
  return useLocation().pathname.startsWith('/chat') ? 'chat' : 'dashboard';
}

export function TopBar() {
  const mode = useMode();
  const { theme, toggleTheme, setPalette, setMobileNav, lastDashboardPath } = useUi();
  const env = useQuery({ queryKey: ['env'], queryFn: Api.env, staleTime: Infinity, retry: false });
  const refreshed = useRefreshed();
  const latest = [refreshed.data?.assets, refreshed.data?.vulnerabilities].filter(Boolean).sort().pop();

  const tab = (active: boolean) =>
    cn('rounded-[5px] px-4 py-1.5 text-[13px] font-medium transition-colors duration-150', active ? 'bg-card text-foreground shadow-[0_0_0_1px_hsl(var(--border))]' : 'text-muted-foreground hover:text-foreground');

  return (
    <header className="no-print z-30 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-background px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        {mode === 'dashboard' && (
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
            <Menu size={18} />
          </Button>
        )}
        <Link to="/dashboard/overview" className="flex min-w-0 items-baseline gap-2" aria-label="Vulnerability Intelligence Platform">
          <span className="font-display text-[22px] leading-none">Vulnerability Intelligence</span>
          <span className="eyebrow hidden lg:inline">Platform</span>
        </Link>
      </div>

      <nav aria-label="Mode" className="flex rounded-md bg-muted p-0.5">
        <Link to={lastDashboardPath} className={tab(mode === 'dashboard')} aria-current={mode === 'dashboard' ? 'page' : undefined}>Dashboard</Link>
        <Link to="/chat" className={tab(mode === 'chat')} aria-current={mode === 'chat' ? 'page' : undefined}>Chatbot</Link>
      </nav>

      <div className="flex items-center justify-end gap-3">
        {latest && <span className="mono hidden text-[11px] text-muted-foreground xl:inline" title="Latest snapshot_date across tables">data · {String(latest).slice(0, 10)}</span>}
        {env.data && (
          <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
            <span className={cn('h-1.5 w-1.5 rounded-full', env.data.env === 'Local dev' ? 'bg-sev-medium' : 'bg-ok')} /> {env.data.env}
          </span>
        )}
        <Button variant="ghost" size="sm" className="hidden gap-2 md:inline-flex" onClick={() => setPalette(true)} aria-label="Open command palette">
          <Search size={14} /> <span className="text-muted-foreground">Search</span> <Kbd>Ctrl K</Kbd>
        </Button>
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </div>
    </header>
  );
}
