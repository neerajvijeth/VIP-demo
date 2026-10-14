import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Api, ApiError } from '@/lib/api';

export interface SqlResult { columns: string[]; rows: Record<string, any>[]; truncated: boolean; maxRows: number; elapsedMs: number; sql: string }
interface HistoryItem { sql: string; at: number }

interface State {
  sql: string;
  maxRows: number;
  history: HistoryItem[];
  // runtime (not persisted)
  running: boolean;
  result: SqlResult | null;
  error: { message: string; detail?: string } | null;
  setSql: (s: string) => void;
  setMaxRows: (n: number) => void;
  run: () => Promise<void>;
  cancel: () => void;
  clearHistory: () => void;
}

let controller: AbortController | null = null;

export const useCustomSql = create<State>()(
  persist(
    (set, get) => ({
      sql: '',
      maxRows: 1000,
      history: [],
      running: false,
      result: null,
      error: null,
      setSql: (sql) => set({ sql }),
      setMaxRows: (maxRows) => set({ maxRows }),
      clearHistory: () => set({ history: [] }),
      cancel: () => controller?.abort(),
      run: async () => {
        const { sql, maxRows, running } = get();
        if (running || !sql.trim()) return;
        controller = new AbortController();
        set({ running: true, error: null });
        try {
          const r = await Api.customRun(sql, maxRows, controller.signal);
          set((s) => ({
            result: { ...r, sql },
            history: [{ sql, at: Date.now() }, ...s.history.filter((h) => h.sql.trim() !== sql.trim())].slice(0, 15),
          }));
        } catch (e: any) {
          if (e?.name === 'AbortError') set({ error: { message: 'Cancelled' } });
          else set({ error: { message: e instanceof ApiError ? e.message : String(e?.message ?? e), detail: (e as ApiError)?.detail } });
        } finally {
          set({ running: false });
          controller = null;
        }
      },
    }),
    { name: 'vip-custom-sql', version: 1, partialize: (s) => ({ sql: s.sql, maxRows: s.maxRows, history: s.history }) },
  ),
);
