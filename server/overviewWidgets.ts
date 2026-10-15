import type { Entity } from '../shared/types';
import { L, semantics } from '../shared/semantics';
import { quoteIdent } from './sqlBuilder';
import { isSelectableColumn } from './fieldCatalog';
import { bandSql } from '../shared/bands';

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
  /** predicate for the executive sections: excludes mobile devices (os_type Android / iOS) */
  base: () => string;
  /** predicate: severity is one of the configured "high" severities */
  critHigh: () => string;
}
export interface WidgetDef {
  id: string;
  entity: Entity;
  sql: (ctx: WidgetCtx) => string;
}

export const sqlLit = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

const CLOSED_EXTRA = ['RESOLVED', 'CLOSED'];

export function makeCtx(table: string, where: string, used?: Set<string>): WidgetCtx {
  const c = (logical: string) => {
    const phys = L(logical);
    used?.add(phys);
    return quoteIdent(phys);
  };
  const { values } = semantics();
  const closed = [...new Set([...values.closedStates.map((s) => s.toUpperCase()), ...CLOSED_EXTRA])];
  return {
    table,
    where,
    c,
    lit: sqlLit,
    // Open = the finding has a state (Tenable state, else Defender status) and it is not a closed one.
    open: () => {
      const names = ['te_state', 'df_status'].filter((n) => isSelectableColumn('vulnerabilities', L(n)));
      const st = `UPPER(COALESCE(${(names.length ? names : ['te_state']).map(c).join(', ')}))`;
      const notFixed = isSelectableColumn('vulnerabilities', L('df_status')) ? ` AND COALESCE(UPPER(${c('df_status')}), '') <> 'FIXED'` : '';
      return `(${st} IS NOT NULL AND ${st} NOT IN (${closed.map(sqlLit).join(', ')})${notFixed})`;
    },
    base: () => `LOWER(COALESCE(CAST(${c('os_type')} AS STRING), '')) NOT IN ('android', 'ios')`,
    critHigh: () => `${c('severity')} IN (${values.highSeverities.map(sqlLit).join(', ')})`,
  };
}

const v = (id: string, sql: WidgetDef['sql']): WidgetDef => ({ id, entity: 'vulnerabilities', sql });
const a = (id: string, sql: WidgetDef['sql']): WidgetDef => ({ id, entity: 'assets', sql });

/** Buckets with an explicit Unknown, so every distribution adds up to its total. */
const bucket = (col: string, edges: Array<[number, number | null, string]>) =>
  'CASE ' + edges.map(([lo, hi, label]) => (hi === null ? `WHEN ${col} >= ${lo} THEN '${label}'` : `WHEN ${col} BETWEEN ${lo} AND ${hi} THEN '${label}'`)).join(' ') + " ELSE 'Unknown' END";
/** Text label that never disappears: NULL / empty becomes Unknown. */
/** COALESCE over the columns that exist in the findings table (at least the first is always required). */
const firstOf = (x: WidgetCtx, names: string[]) => {
  const present = names.filter((n, i) => i === 0 || isSelectableColumn('vulnerabilities', L(n)));
  return present.length > 1 ? `COALESCE(${present.map((n) => (n === 'plugin_id' ? `CAST(${x.c(n)} AS STRING)` : x.c(n))).join(', ')})` : x.c(present[0]);
};
const lab = (col: string) => `COALESCE(NULLIF(CAST(${col} AS STRING), ''), 'Unknown')`;

export const WIDGETS: WidgetDef[] = [
  // Row 1: headline cards. Findings are counted as rows of the de-duplicated findings table.
  a('kpiTotalAssets', (x) => `SELECT COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where}`),
  v('kpiOpenVulns', (x) => `SELECT COUNT(*) AS value FROM ${x.table} ${x.where} AND ${x.open()}`),
  v('kpiCritHigh', (x) => `SELECT COUNT(*) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.critHigh()}`),
  v('kpiKev', (x) => `SELECT COUNT(*) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND COALESCE(${x.c('kev_flag')}, false) = true`),
  v('kpiSla', (x) => `SELECT COUNT(*) AS total, COUNT_IF(COALESCE(${x.c('sla_breached')}, false) = true) AS breached FROM ${x.table} ${x.where} AND ${x.open()}`),
  v('kpiExposedCritHigh', (x) => `SELECT COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND COALESCE(${x.c('internet_exposed')}, false) = true AND ${x.critHigh()}`),

  // Row 2
  v('severityDonut', (x) => `SELECT ${lab(x.c('severity'))} AS label, COUNT(*) AS value FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY 1`),
  v('slaStatus', (x) => `SELECT ${lab(x.c('sla_status'))} AS label, COUNT(*) AS value FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY 1`),
  v('overdueBuckets', (x) => `SELECT ${bucket(x.c('overdue_days'), [[1, 30, '1-30'], [31, 60, '31-60'], [61, 90, '61-90'], [91, null, '90+']])} AS label, COUNT(*) AS value FROM ${x.table} ${x.where} AND ${x.open()} AND COALESCE(${x.c('overdue_days')}, 0) > 0 GROUP BY 1`),
  v('ageBuckets', (x) => `SELECT ${bucket(x.c('vulnerability_age_days'), [[0, 30, '0-30'], [31, 60, '31-60'], [61, 90, '61-90'], [91, 180, '91-180'], [181, null, '180+']])} AS label, COUNT(*) AS value FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY 1`),

  // Row 3: top 10 tables. A vulnerability is keyed by CVE, else plugin CVE, else plugin id; named by name, else title.
  v('topAssets', (x) => `SELECT ${x.c('gold_asset_id')} AS gold_asset_id, MAX(${x.c('hostname')}) AS hostname, MAX(${lab(x.c('criticality'))}) AS criticality, COUNT(*) AS vulns, COUNT_IF(COALESCE(${x.c('kev_flag')}, false) = true) AS kev, MAX(${x.c('final_score')}) AS max_score, SUM(${x.c('final_score')}) AS total_score FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY ${x.c('gold_asset_id')} ORDER BY total_score DESC NULLS LAST LIMIT 10`),
  v('topVulns', (x) => {
    const key = firstOf(x, ['cve', 'plugin_cve', 'plugin_id']);
    return `SELECT MAX(${firstOf(x, ['vulnerability_name', 'title'])}) AS vulnerability_name, ${key} AS cve, MAX_BY(${x.c('severity')}, COALESCE(${x.c('final_score')}, 0)) AS severity, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS assets, COUNT(*) AS findings FROM ${x.table} ${x.where} AND ${x.open()} AND ${key} IS NOT NULL GROUP BY ${key} ORDER BY assets DESC, findings DESC LIMIT 10`;
  }),
  v('topSoftware', (x) => `SELECT ${x.c('software_name')} AS software_name, MAX(${x.c('recommended_version')}) AS recommended_version, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS assets, COUNT(*) AS vulns FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.c('software_name')} IS NOT NULL GROUP BY ${x.c('software_name')} ORDER BY vulns DESC, assets DESC LIMIT 10`),

  // Row 4
  v('riskByBusinessUnit', (x) => `SELECT ${lab(x.c('business_unit'))} AS business_unit, ${lab(x.c('severity'))} AS severity, COUNT(*) AS value FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY 1, 2`),
  // Business criticality. Missing or defaulted values are shown as such: never as Low.
  // Breakdown cards: the same two numbers for any attribute. Assets come from the asset scope, findings from the finding scope,
  // so each honours every filter exactly like the headline cards, and each column adds up to its headline number.
  ...(['business_unit', 'region'] as const).flatMap((attr) => {
    const name = attr === 'business_unit' ? 'BusinessUnit' : 'Region';
    return [
      a(`assetsBy${name}`, (x) => `SELECT ${lab(x.c(attr))} AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} GROUP BY 1`),
      v(`findingsBy${name}`, (x) => `SELECT ${lab(x.c(attr))} AS label, COUNT(*) AS findings, COUNT_IF(${x.critHigh()}) AS crit_high, COUNT_IF(COALESCE(${x.c('kev_flag')}, false) = true) AS kev, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS assets_affected FROM ${x.table} ${x.where} AND ${x.open()} GROUP BY 1`),
    ];
  }),
  a('assetsByCriticality', (x) => `SELECT CASE WHEN ${x.c('criticality')} IS NULL${isSelectableColumn('assets', L('criticality_normalization_method')) ? ` OR LOWER(COALESCE(${x.c('criticality_normalization_method')}, '')) LIKE '%default%'` : ''} THEN 'Unknown (defaulted)' ELSE ${x.c('criticality')} END AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} GROUP BY 1`),
  a('assetsByClass', (x) => `SELECT ${lab(x.c('asset_class'))} AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} GROUP BY 1`),
  a('coverage', (x) => `SELECT COUNT(DISTINCT ${x.c('gold_asset_id')}) AS total, COUNT(DISTINCT CASE WHEN ${x.c('te_has_agent')} = true THEN ${x.c('gold_asset_id')} END) AS with_agent, COUNT(DISTINCT CASE WHEN ${x.c('te_has_agent')} = false THEN ${x.c('gold_asset_id')} END) AS without_agent, COUNT(DISTINCT CASE WHEN ${x.c('te_has_agent')} IS NULL THEN ${x.c('gold_asset_id')} END) AS unknown_agent, COUNT(DISTINCT CASE WHEN ${x.c('asset_aging_status')} = ${x.lit(semantics().values.staleStatus)} THEN ${x.c('gold_asset_id')} END) AS stale, COUNT(DISTINCT CASE WHEN ${x.c('asset_aging_status')} = ${x.lit(semantics().values.agingStatus)} THEN ${x.c('gold_asset_id')} END) AS aging FROM ${x.table} ${x.where}`),
  a('toolVisibility', (x) => `SELECT ${lab(x.c('tool_visibility'))} AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} GROUP BY 1`),
  v('eolAssets', (x) => `SELECT COUNT(DISTINCT CASE WHEN ${x.c('df_end_of_support_status')} = ${x.lit(semantics().values.eos)} THEN ${x.c('gold_asset_id')} END) AS eos, COUNT(DISTINCT CASE WHEN ${x.c('df_end_of_support_status')} = ${x.lit(semantics().values.upcomingEos)} THEN ${x.c('gold_asset_id')} END) AS upcoming FROM ${x.table} ${x.where} AND ${x.open()}`),
];

// ============================================================================================================
// Executive sections (asset overview / server score bands / top applications / top servers).
// Base rules for every widget below: open findings only, latest snapshot (the page switch), no Android / iOS devices,
// asset ids counted distinct, and a "unique vulnerability" is a distinct (asset, CVE) pair, CVE key = cve, else plugin CVE, else plugin id.
// ============================================================================================================
const SERVER = (x: WidgetCtx) => `LOWER(COALESCE(CAST(${x.c('asset_class')} AS STRING), '')) = 'server'`;
const key = (x: WidgetCtx) => `COALESCE(${firstOf(x, ['cve', 'plugin_cve', 'plugin_id'])}, 'unknown')`;
/** One row per (asset, vulnerability) with the worst score, KEV / SLA flags and best priority across its duplicate findings. */
const pairs = (x: WidgetCtx, extraWhere = '', extraCols = '') =>
  `SELECT ${x.c('gold_asset_id')} AS asset, ${key(x)} AS vkey, MAX(${x.c('final_score')}) AS score, MAX(CASE WHEN COALESCE(${x.c('kev_flag')}, false) = true THEN 1 ELSE 0 END) AS kev, MAX(CASE WHEN COALESCE(${x.c('sla_breached')}, false) = true THEN 1 ELSE 0 END) AS breached, MIN(${x.c('priority_rank')}) AS prank${extraCols} FROM ${x.table} ${x.where} AND ${x.open()} AND ${x.base()}${extraWhere} GROUP BY ${x.c('gold_asset_id')}, ${key(x)}`;
/** OS label for the server chart: Windows Server by release (2012 R2, 2016, ...), Linux by distribution, else the OS name. */
const osLabel = (x: WidgetCtx) => {
  const name = `CAST(${x.c('os_name')} AS STRING)`;
  const dist = isSelectableColumn('assets', L('os_distribution')) ? `NULLIF(CAST(${x.c('os_distribution')} AS STRING), '')` : 'NULL';
  return `CASE WHEN ${name} RLIKE '(?i)windows server' THEN COALESCE(NULLIF(regexp_extract(${name}, '(?i)(windows server +[0-9]{4}( +r2)?)', 1), ''), 'Windows Server (other)')
    WHEN LOWER(COALESCE(CAST(${x.c('os_type')} AS STRING), '')) = 'linux' THEN COALESCE(${dist}, NULLIF(${name}, ''), 'Linux (other)')
    ELSE COALESCE(NULLIF(${name}, ''), 'Unknown') END`;
};

WIDGETS.push(
  // ---- Section 1: asset overview and server classification ----
  a('execTotals', (x) => `SELECT COUNT(DISTINCT ${x.c('gold_asset_id')}) AS total, COUNT(DISTINCT CASE WHEN ${SERVER(x)} THEN ${x.c('gold_asset_id')} END) AS servers FROM ${x.table} ${x.where} AND ${x.base()}`),
  a('execByClass', (x) => `SELECT ${lab(x.c('asset_class'))} AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} AND ${x.base()} GROUP BY 1`),
  a('execServersByOs', (x) => `SELECT ${osLabel(x)} AS label, COUNT(DISTINCT ${x.c('gold_asset_id')}) AS value FROM ${x.table} ${x.where} AND ${x.base()} AND ${SERVER(x)} GROUP BY 1 ORDER BY value DESC, label ASC`),

  // ---- Section 2: server vulnerability score distribution (bands on final_score) ----
  v('execServerBands', (x) => `SELECT band AS label, COUNT(*) AS value FROM (SELECT ${bandSql('score')} AS band FROM (${pairs(x, ` AND ${SERVER(x)}`)}) p) b WHERE band IS NOT NULL GROUP BY 1`),
  v('execServerKpis', (x) => `SELECT COUNT(DISTINCT CASE WHEN kev = 1 THEN asset END) AS servers_kev, COUNT(DISTINCT CASE WHEN breached = 1 THEN asset END) AS servers_breach, COUNT(DISTINCT asset) AS servers_with_vulns, COUNT(*) AS unique_vulns, COUNT_IF(score IS NULL) AS no_score FROM (${pairs(x, ` AND ${SERVER(x)}`)}) p`),

  // ---- Section 3: top applications (all assets) ----
  ...(['Count', 'Score'] as const).map((by) =>
    v(`execAppsBy${by}`, (x) => {
      const sw = x.c('software_name');
      const inner = pairs(x, ` AND ${sw} IS NOT NULL`, `, ${sw} AS software`).replace(`GROUP BY ${x.c('gold_asset_id')}, ${key(x)}`, `GROUP BY ${x.c('gold_asset_id')}, ${key(x)}, ${sw}`);
      const order = by === 'Count' ? 'vulns DESC, assets DESC, max_score DESC NULLS LAST' : 'max_score DESC NULLS LAST, vulns DESC';
      return `SELECT software AS software_name, COUNT(*) AS vulns, COUNT(DISTINCT asset) AS assets, SUM(kev) AS kev, MAX(score) AS max_score, MIN(prank) AS prank FROM (${inner}) p GROUP BY software ORDER BY ${order}, software ASC LIMIT 10`;
    }),
  ),

  // ---- Section 4: top servers by open unique vulnerabilities ----
  v('execTopServers', (x) => {
    // the finding source exposes the asset's normalisation method as asset_criticality_method
    const crit = `CASE WHEN ${x.c('criticality')} IS NULL${isSelectableColumn('assets', L('criticality_normalization_method')) ? " OR LOWER(COALESCE(`asset_criticality_method`, '')) LIKE '%default%'" : ''} THEN 'Unknown (defaulted)' ELSE ${x.c('criticality')} END`;
    const inner = pairs(x, ` AND ${SERVER(x)}`, `, MAX(${x.c('hostname')}) AS hostname, MAX(${lab(osLabel(x))}) AS os, MAX(${lab(x.c('business_unit'))}) AS business_unit, MAX(${lab(x.c('region'))}) AS region, MAX(${crit}) AS criticality, MAX(CASE WHEN COALESCE(${x.c('internet_exposed')}, false) = true THEN 1 ELSE 0 END) AS internet`);
    return `SELECT asset AS gold_asset_id, MAX(hostname) AS hostname, MAX(os) AS os, MAX(business_unit) AS business_unit, MAX(region) AS region, MAX(criticality) AS criticality, MAX(internet) AS internet, COUNT(*) AS total, COUNT_IF(${bandSql('score')} = 'Critical') AS critical, COUNT_IF(${bandSql('score')} = 'High') AS high, COUNT_IF(${bandSql('score')} = 'Medium') AS medium, COUNT_IF(${bandSql('score')} = 'Low') AS low, SUM(kev) AS kev, MAX(score) AS max_score FROM (${inner}) p GROUP BY asset ORDER BY total DESC, max_score DESC NULLS LAST, hostname ASC LIMIT 25`;
  }),
);

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

/** Physical columns a widget needs (found by dry-running its SQL builder with a recording context). */
export function requiredColumns(def: WidgetDef): string[] {
  const used = new Set<string>();
  def.sql(makeCtx('t', 'WHERE TRUE', used));
  return [...used];
}
