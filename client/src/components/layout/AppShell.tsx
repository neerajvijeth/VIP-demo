import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TopBar, useMode } from './TopBar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { Toaster } from '@/components/ui/toaster';
import { useUi } from '@/store/ui';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

function useGlobalShortcuts() {
  const navigate = useNavigate();
  const setPalette = useUi((s) => s.setPalette);
  const pending = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (pending.current) {
        clearTimeout(pending.current);
        pending.current = null;
        const dest = { o: '/dashboard/overview', a: '/dashboard/assets', v: '/dashboard/vulnerabilities', s: '/dashboard/sql', c: '/chat' }[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
        return;
      }
      if (e.key === 'g') pending.current = window.setTimeout(() => (pending.current = null), 1000);
      else if (e.key === '/') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('vip:focus-field-search'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, setPalette]);
}

export function AppShell() {
  const mode = useMode();
  const { pathname } = useLocation();
  const prev = useRef(mode);
  const dirRef = useRef<'right' | 'left' | null>(null);
  const setLast = useUi((s) => s.setLastDashboardPath);
  useGlobalShortcuts();

  if (prev.current !== mode) {
    dirRef.current = mode === 'chat' ? 'right' : 'left';
    prev.current = mode;
  }
  useEffect(() => {
    if (pathname.startsWith('/dashboard')) setLast(pathname);
  }, [pathname, setLast]);

  const anim = dirRef.current === 'right' ? 'animate-slide-from-right' : dirRef.current === 'left' ? 'animate-slide-from-left' : '';
  return (
    <div className="print-root flex h-full flex-col">
      <TopBar />
      <div key={mode} className={`flex min-h-0 flex-1 ${anim}`}>
        {mode === 'dashboard' && <Sidebar />}
        <main className="print-root min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
