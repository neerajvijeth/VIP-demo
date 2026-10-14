/**
 * The few names and values the app's *logic* depends on (everything else is discovered from the warehouse).
 * Defaults match the current gold tables; override through environment variables on the server
 * (TABLE_*, COLUMN_MAP, CLOSED_STATES, …). The client receives the effective values from /api/env.
 */
export interface Semantics {
  tables: { assets: string; vulnerabilities: string; kpi: string };
  /** logical column name → physical column name (only entries that differ) */
  columns: Record<string, string>;
  values: {
    /** te_state values that mean a finding is closed (everything else is "open") */
    closedStates: string[];
    /** severities counted as "critical / high" */
    highSeverities: string[];
    staleStatus: string;
    agingStatus: string;
    eos: string;
    upcomingEos: string;
  };
}

export const DEFAULT_SEMANTICS: Semantics = {
  tables: { assets: 'gold_assets', vulnerabilities: 'gold_vulnerabilities', kpi: 'gold_kpi_metrics' },
  columns: {},
  values: { closedStates: ['FIXED'], highSeverities: ['Critical', 'High'], staleStatus: 'Stale', agingStatus: 'Aging', eos: 'EOS', upcomingEos: 'Upcoming EOS' },
};

let current: Semantics = DEFAULT_SEMANTICS;
export function setSemantics(s: { tables?: Partial<Semantics['tables']>; columns?: Record<string, string>; values?: Partial<Semantics['values']> }) {
  current = {
    tables: { ...DEFAULT_SEMANTICS.tables, ...(s.tables ?? {}) },
    columns: { ...(s.columns ?? {}) },
    values: { ...DEFAULT_SEMANTICS.values, ...(s.values ?? {}) },
  };
}
export const semantics = (): Semantics => current;
/** logical → physical column name */
export const L = (logical: string): string => current.columns[logical] ?? logical;
/** physical → logical column name (identity when not remapped) */
export const logicalOf = (physical: string): string => Object.entries(current.columns).find(([, p]) => p === physical)?.[0] ?? physical;
