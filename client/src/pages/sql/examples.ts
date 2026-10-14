import { L, semantics } from '@shared/semantics';

export const tableNames = () => {
  const t = semantics().tables;
  return [t.assets, t.vulnerabilities, t.kpi];
};

/** Example queries built from the configured table and column names (so they run on renamed data too). */
export function makeExamples(catalog: string, schema: string) {
  const t = semantics().tables;
  const A = `${catalog}.${schema}.${t.assets}`;
  const V = `${catalog}.${schema}.${t.vulnerabilities}`;
  const K = `${catalog}.${schema}.${t.kpi}`;
  const snap = L('snapshot_date');
  const latest = (tbl: string, alias = '') => `${alias}${snap} = (SELECT MAX(${snap}) FROM ${tbl})`;
  const aid = L('gold_asset_id'), fid = L('finding_id'), bu = L('business_unit'), sev = L('severity'), st = L('te_state');
  const closed = semantics().values.closedStates.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
  return [
    { title: 'Assets per business unit', sql: `SELECT ${bu}, COUNT(DISTINCT ${aid}) AS assets\nFROM ${A}\nWHERE ${latest(A)}\nGROUP BY ${bu}\nORDER BY assets DESC` },
    { title: 'Open findings by severity', sql: `SELECT ${sev}, COUNT(DISTINCT ${fid}) AS findings\nFROM ${V}\nWHERE ${latest(V)}\n  AND ${st} NOT IN (${closed})\nGROUP BY ${sev}\nORDER BY findings DESC` },
    { title: 'Riskiest assets (top 20)', sql: `SELECT ${L('hostname')}, ${L('criticality')}, COUNT(DISTINCT ${fid}) AS findings, ROUND(SUM(${L('final_score')}), 1) AS total_score\nFROM ${V}\nWHERE ${latest(V)}\n  AND ${st} NOT IN (${closed})\nGROUP BY ${L('hostname')}, ${L('criticality')}\nORDER BY total_score DESC\nLIMIT 20` },
    { title: 'KEV findings on internet-exposed assets', sql: `SELECT ${L('hostname')}, ${L('vulnerability_name')}, ${L('cve')}, ${sev}, ${L('sla_status')}, ${L('overdue_days')}\nFROM ${V}\nWHERE ${latest(V)}\n  AND ${L('kev_flag')} = true\n  AND ${L('internet_exposed')} = true\nORDER BY ${L('overdue_days')} DESC` },
    { title: 'Findings joined to asset details', sql: `SELECT a.${bu}, a.${L('region')}, COUNT(*) AS findings\nFROM ${V} v\nJOIN ${A} a\n  ON v.${aid} = a.${aid} AND v.${snap} = a.${snap}\nWHERE ${latest(V, 'v.')}\nGROUP BY a.${bu}, a.${L('region')}\nORDER BY findings DESC` },
    { title: 'Trend: first metric over time', sql: `SELECT ${snap}, ${L('metric_name')}, ${L('metric_value')}\nFROM ${K}\nORDER BY ${snap} DESC\nLIMIT 100` },
    { title: 'Describe a table', sql: `DESCRIBE TABLE ${A}` },
  ];
}
