import type { Entity } from '../shared/types';
import { L, semantics } from '../shared/semantics';
import { quoteIdent } from './sqlBuilder';

/**
 * Widget registry for the Overview page. Every widget queries exactly ONE table.
 * Column names go through `c('logical_name')` (resolved with the COLUMN_MAP override) and business values come from the
 * configured semantics, so the same widgets work on differently named columns / differently spelled values.
 * `where` is a ready-made clause (scope toggles + global filters, parameterised) and always starts with WHERE.
 */
export interface WidgetCtx {
  table: string;
  where: string;
  /** quoted physical column for a logical name */
  c: (logical: string) => string;
  /** SQL string literal (escaped) */
  lit: (s: string) => string;
  /** predicate: finding is not in a closed state */
  open: () => string;
  /** predicate: severity is one of the configured "high" severities */
  critHigh: () => string;
}
export interface WidgetDef {
  id: string;
  entity: Entity;
  sql: (ctx: WidgetCtx) => string;
}

export const sqlLit = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

export function makeCtx(table: string, where: string, used?: Set<string>): WidgetCtx {
  const c = (logical: string) => {
    const phys = L(logical);
    used?.add(phys);
    return quoteIdent(phys);
  };
  const { values } = semantics();
  return {
    table,
    where,
    c,
    lit: sqlLit,
    open: () => `COALESCE(UPPER(${c('te_state')}), '') NOT IN (${values.closedStates.map((s) => sqlLit(s.toUpperCase())).join(', ')})`,
    critHigh: () => `${c('severity')} IN (${values.highSeverities.map(sqlLit).join(', ')})`,
  };
}

const v = (id: string, sql: WidgetDef['sql']): WidgetDef => ({ id, entity: 'vulnerabilities', sql });
const a = (id: string, sql: WidgetDef['sql']): WidgetDef => ({ id, entity: 'assets', sql });

const bucket = (col: string, edges: Array<[number, number | null, string]>) =>
  'CASE ' + edges.map(([lo, hi, label]) => (hi === null ? `WHEN ${col} >= ${lo} THEN '${label}'` : `WHEN ${col} BETWEEN ${lo} AND ${hi} THEN '${label}'`)).join(' ') + ' END';

export const WIDGETS: WidgetDef[] = [
  // Row 1 — headline cards
  a('kpiTotalAssets', (x) => `SELECT COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where}`),
  v('kpiOpenVulns', (x) => `SELECT COUNT(DISTINCT ${x.c('finding_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()}`),
  v('kpiCritHigh', (x) => `SELECT COUNT(DISTINCT ${x.c('finding_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.critHigh()}`),
  v('kpiKev', (x) => `SELECT COUNT(DISTINCT ${x.c('finding_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.c('kev_flag')} = true`),
  v('kpiSla', (x) => `SELECT COUNT(DISTINCT ${x.c('finding_id')}) AS total, COUNT(DISTINCT CASE WHEN ${x.c('sla_breached')} = true THEN ${x.c('finding_id')} END) AS breached FROM ${x.table} ${x.where} AND ${x.open()}`),
  v('kpiExposedCritHigh', (x) => `SELECT COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.c('internet_exposed')} = true AND ${x.critHigh()}`),

  // Row 2
  v('severityDonut', (x) => `SELECT ${x.c('severity')} AS label, COUNT(DISTINCT ${x.c('finding_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY ${x.c('severity')}`),
  v('slaStatus', (x) => `SELECT ${x.c('sla_status')} AS label, COUNT(DISTINCT ${x.c('finding_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY ${x.c('sla_status')}`),
  v('overdueBuckets', (x) => `SELECT ${bucket(x.c('overdue_days'), [[1, 30, '1-30'], [31, 60, '31-60'], [61, 90, '61-90'], [91, null, '90+']])} AS label, COUNT(DISTINCT ${x.c('finding_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.c('overdue_days')} > 0 GROUP BY 1`),
  v('ageBuckets', (x) => `SELECT ${bucket(x.c('vulnerability_age_days'), [[0, 30, '0-30'], [31, 60, '31-60'], [61, 90, '61-90'], [91, 180, '91-180'], [181, null, '180+']])} AS label, COUNT(DISTINCT ${x.c('finding_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.c('vulnerability_age_days')} IS NOT NULL GROUP BY 1`),

  // Row 3 — top 10 tables
  v('topAssets', (x) => `SELECT ${x.c('gold_asset_id')} AS gold_asset_id, ${x.c('hostname')} AS hostname, MAX(${x.c('criticality')}) AS criticality, COUNT(DISTINCT ${x.c('finding_id')}) AS vulns, COUNT(DISTINCT CASE WHEN ${x.c('kev_flag')} = true THEN ${x.c('finding_id')} END) AS kev, MAX(${x.c('final_score')}) AS max_score, SUM(${x.c('final_score')}) AS total_score FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY ${x.c('gold_asset_id')}, ${x.c('hostname')} ORDER BY total_score DESC LIMIT 10`),
  v('topVulns', (x) => `SELECT ${x.c('vulnerability_name')} AS vulnerability_name, ${x.c('cve')} AS cve, MAX(${x.c('severity')}) AS severity, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS assets, COUNT(DISTINCT ${x.c('finding_id')}) AS findings FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY ${x.c('vulnerability_name')}, ${x.c('cve')} ORDER BY assets DESC, findings DESC LIMIT 10`),
  v('topSoftware', (x) => `SELECT ${x.c('software_name')} AS software_name, MAX(${x.c('recommended_version')}) AS recommended_version, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS assets, COUNT(DISTINCT ${x.c('finding_id')}) AS vulns FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.c('software_name')} IS NOT NULL GROUP BY ${x.c('software_name')} ORDER BY vulns DESC, assets DESC LIMIT 10`),

  // Row 4
  v('riskByBusinessUnit', (x) => `SELECT ${x.c('business_unit')} AS business_unit, ${x.c('severity')} AS severity, COUNT(DISTINCT ${x.c('finding_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY ${x.c('business_unit')}, ${x.c('severity')}`),
  a('assetsByCriticality', (x) => `SELECT ${x.c('criticality')} AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} GROUP BY ${x.c('criticality')}`),
  a('assetsByClass', (x) => `SELECT ${x.c('asset_class')} AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} GROUP BY ${x.c('asset_class')}`),
  a('coverage', (x) => `SELECT COUNT(DISTINCT ${x.c('gold_asset_id')}) AS total, COUNT(DISTINCT CASE WHEN ${x.c('te_has_agent')} = true THEN ${x.c('gold_asset_id')} END) AS with_agent, COUNT(DISTINCT CASE WHEN ${x.c('te_has_agent')} = false THEN ${x.c('gold_asset_id')} END) AS without_agent, COUNT(DISTINCT CASE WHEN ${x.c('asset_aging_status')} = ${x.lit(semantics().values.staleStatus)} THEN ${x.c('gold_asset_id')} END) AS stale, COUNT(DISTINCT CASE WHEN ${x.c('asset_aging_status')} = ${x.lit(semantics().values.agingStatus)} THEN ${x.c('gold_asset_id')} END) AS aging FROM ${x.table} ${x.where}`),
  a('toolVisibility', (x) => `SELECT ${x.c('tool_visibility')} AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} GROUP BY ${x.c('tool_visibility')}`),
  v('eolAssets', (x) => `SELECT COUNT(DISTINCT CASE WHEN ${x.c('df_end_of_support_status')} = ${x.lit(semantics().values.eos)} THEN ${x.c('gold_asset_id')} END) AS eos, COUNT(DISTINCT CASE WHEN ${x.c('df_end_of_support_status')} = ${x.lit(semantics().values.upcomingEos)} THEN ${x.c('gold_asset_id')} END) AS upcoming FROM ${x.table} ${x.where} AND ${x.open()}`),
];

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

/** Physical columns a widget needs (found by dry-running its SQL builder with a recording context). */
export function requiredColumns(def: WidgetDef): string[] {
  const used = new Set<string>();
  def.sql(makeCtx('t', 'WHERE TRUE', used));
  return [...used];
}
