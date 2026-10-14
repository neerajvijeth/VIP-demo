import { create } from 'zustand';

type Theme = 'dark' | 'light';
const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  paletteOpen: boolean;
  lastDashboardPath: string;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setMobileNav: (b: boolean) => void;
  setPalette: (b: boolean) => void;
  setLastDashboardPath: (p: string) => void;
}

const initialTheme = (): Theme => {
  try {
    return localStorage.getItem('vip-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme(),
  sidebarCollapsed: read('vip-sidebar-collapsed', false),
  mobileNavOpen: false,
  paletteOpen: false,
  lastDashboardPath: '/dashboard/overview',
  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('vip-theme', theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    write('vip-sidebar-collapsed', v);
    set({ sidebarCollapsed: v });
  },
  setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setLastDashboardPath: (lastDashboardPath) => set({ lastDashboardPath }),
}));
