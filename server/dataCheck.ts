import { L, semantics } from '../shared/semantics';
import { entityTable } from './config';
import { cached, scopeOf } from './cache';
import { query } from './db';
import { isSelectableColumn } from './fieldCatalog';
import { quoteIdent } from './sqlBuilder';

export interface DataCheck { warnings: string[]; info: string[] }

async function distinct(entity: 'assets' | 'vulnerabilities', logical: string, token?: string): Promise<string[] | null> {
  const col = L(logical);
  if (!isSelectableColumn(entity, col)) return null;
  const sql = `SELECT DISTINCT CAST(${quoteIdent(col)} AS STRING) AS v FROM ${entityTable(entity)} WHERE ${quoteIdent(col)} IS NOT NULL LIMIT 200`;
  const rows = await cached(`dc|${scopeOf(token)}|${sql}`, () => query(sql, {}, { userToken: token }), { ttlMs: 30 * 60_000 });
  return rows.map((r) => String(r.v));
}

/** Compares configured business values with what the data actually contains. Cached for 30 min (3 tiny queries). */
export async function runDataCheck(token?: string): Promise<DataCheck> {
  const sem = semantics();
  const warnings: string[] = [];
  const info: string[] = [];
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));

  const sev = await distinct('vulnerabilities', 'severity', token).catch(() => null);
  if (sev && sev.length && !sem.values.highSeverities.some((h) => lower(sev).has(h.toLowerCase()))) {
    warnings.push(`None of the configured high severities (${sem.values.highSeverities.join(', ')}) appear in "${L('severity')}". Values found: ${sev.slice(0, 8).join(', ')}. Set HIGH_SEVERITIES to match.`);
  }
  const state = await distinct('vulnerabilities', 'te_state', token).catch(() => null);
  if (state && state.length) {
    const open = state.filter((s) => !lower(sem.values.closedStates).has(s.toLowerCase()));
    if (!open.length) warnings.push(`Every value in "${L('te_state')}" (${state.slice(0, 8).join(', ')}) is treated as closed (CLOSED_STATES = ${sem.values.closedStates.join(', ')}), so "open" counts will be 0.`);
    else info.push(`Open findings = "${L('te_state')}" (else "df_status") not in [${sem.values.closedStates.join(', ')}, RESOLVED, CLOSED]. States found: ${state.slice(0, 8).join(', ')}.`);
  }
  for (const e of ['assets', 'vulnerabilities'] as const) {
    if (!isSelectableColumn(e, L('snapshot_date'))) info.push(`${sem.tables[e]} has no "${L('snapshot_date')}" column: the "Latest snapshot only" switch is disabled and all rows are used.`);
    if (!isSelectableColumn(e, L('is_valid'))) info.push(`${sem.tables[e]} has no "${L('is_valid')}" column: the "Valid records only" switch is disabled.`);
  }
  return { warnings, info };
}
