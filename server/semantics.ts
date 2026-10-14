import { DEFAULT_SEMANTICS, setSemantics, type Semantics } from '../shared/semantics';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TABLE = /^[A-Za-z0-9_\-]+$/;
const csv = (v: string | undefined, d: string[]) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : d);
const lit = (v: string | undefined, d: string) => (v && v.trim() ? v.trim() : d);

/** Reads overrides from the environment; invalid identifiers fail fast at startup. */
export function loadSemantics(env: NodeJS.ProcessEnv = process.env): Semantics {
  const d = DEFAULT_SEMANTICS;
  const tables = {
    assets: lit(env.TABLE_ASSETS, d.tables.assets),
    vulnerabilities: lit(env.TABLE_VULNERABILITIES, d.tables.vulnerabilities),
    kpi: lit(env.TABLE_KPI_METRICS, d.tables.kpi),
  };
  for (const [k, v] of Object.entries(tables)) if (!TABLE.test(v)) throw new Error(`Invalid table name for ${k}: ${v}`);

  let columns: Record<string, string> = {};
  if (env.COLUMN_MAP) {
    try {
      columns = JSON.parse(env.COLUMN_MAP);
    } catch {
      throw new Error('COLUMN_MAP must be JSON like {"kev_flag":"is_kev","te_state":"state"}');
    }
    for (const [k, v] of Object.entries(columns)) {
      if (typeof v !== 'string' || !IDENT.test(k) || !IDENT.test(v)) throw new Error(`Invalid COLUMN_MAP entry: ${k} -> ${String(v)}`);
    }
  }
  const values = {
    closedStates: csv(env.CLOSED_STATES, d.values.closedStates),
    highSeverities: csv(env.HIGH_SEVERITIES, d.values.highSeverities),
    staleStatus: lit(env.STALE_STATUS, d.values.staleStatus),
    agingStatus: lit(env.AGING_STATUS, d.values.agingStatus),
    eos: lit(env.EOS_STATUS, d.values.eos),
    upcomingEos: lit(env.UPCOMING_EOS_STATUS, d.values.upcomingEos),
  };
  const sem = { tables, columns, values };
  setSemantics(sem);
  return { ...d, ...sem };
}
