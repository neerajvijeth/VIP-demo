import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Entity, SummarySpec } from '@shared/types';
import { emptySummary } from '@shared/types';
import { uid } from '@/lib/utils';

export interface SummaryCardCfg {
  id: string;
  entity: Entity;
  spec: SummarySpec;
  /** vulnerabilities only: count open findings (te_state is not FIXED) */
  openOnly: boolean;
}
interface State {
  cards: SummaryCardCfg[];
  add: () => void;
  update: (id: string, patch: Partial<SummaryCardCfg>) => void;
  remove: (id: string) => void;
}
const seed = (): SummaryCardCfg[] => [{ id: uid(), entity: 'assets', spec: emptySummary('assets'), openOnly: true }];

export const useSummaries = create<State>()(
  persist(
    (set) => ({
      cards: seed(),
      add: () => set((s) => (s.cards.length >= 6 ? s : { cards: [...s.cards, { id: uid(), entity: 'vulnerabilities', spec: emptySummary('vulnerabilities'), openOnly: true }] })),
      update: (id, patch) => set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      remove: (id) => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),
    }),
    { name: 'vip-overview-summaries', version: 1 },
  ),
);
