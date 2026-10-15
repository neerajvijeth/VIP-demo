/** Live-warehouse checks of the executive sections: VIP_IT=1 npx vitest run server/execSections.integration */
import { beforeAll, describe, expect, it } from 'vitest';
import { fillBands } from '../shared/bands';
import { derivedExtras, filtersToTree } from '../shared/filters';
import { EMPTY_FILTERS, type ExtraFilter } from '../shared/types';
import { entityTable } from './config';
import { query } from './db';
import { syncSchema } from './schema';
import { widgetScope } from './overviewScope';
import { canonicalSource } from './overviewSource';
import { WIDGET_BY_ID, makeCtx } from './overviewWidgets';

const run = process.env.VIP_IT ? describe : describe.skip;
const n = (v: unknown) => Number(v);

// ---------------------------------------------------------------- controlled data
type Cell = string | number | boolean | null;
const lit = (v: Cell, type: string) => (v === null ? `CAST(NULL AS ${type})` : typeof v === 'string' ? `CAST('${v.replace(/'/g, "''")}' AS ${type})` : `CAST(${v} AS ${type})`);
function synth(cols: Array<[string, string]>, rows: Cell[][]): string {
  const vals = rows.map((r) => `(${r.map((v, i) => lit(v, cols[i][1])).join(', ')})`).join(', ');
  return `(SELECT * FROM VALUES ${vals} AS v(${cols.map((c) => '`' + c[0] + '`').join(', ')})) t`;
}
const run1 = async (id: string, table: string, where = 'WHERE TRUE') => query(WIDGET_BY_ID.get(id)!.sql(makeCtx(table, where)));

const FCOLS: Array<[string, string]> = [['gold_asset_id', 'STRING'], ['cve', 'STRING'], ['plugin_cve', 'STRING'], ['plugin_id', 'INT'], ['final_score', 'DOUBLE'], ['kev_flag', 'BOOLEAN'], ['sla_breached', 'BOOLEAN'], ['priority_rank', 'INT'], ['te_state', 'STRING'], ['df_status', 'STRING'], ['asset_class', 'STRING'], ['os_type', 'STRING'], ['os_name', 'STRING'], ['os_distribution', 'STRING'], ['hostname', 'STRING'], ['business_unit', 'STRING'], ['region', 'STRING'], ['criticality', 'STRING'], ['asset_criticality_method', 'STRING'], ['internet_exposed', 'BOOLEAN'], ['software_name', 'STRING']];
//                 asset  cve      pcve  pid   score  kev    sla    prank state     df        class        os_type    os_name                                 dist   host   bu    region  crit    method        inet   software
const F = (a: string, cve: string | null, score: number | null, over: Partial<Record<string, Cell>> = {}): Cell[] => {
  const base: Record<string, Cell> = { asset: a, cve, pcve: null, pid: 1, score, kev: false, sla: false, prank: 3, state: 'ACTIVE', df: 'Active', cls: 'Server', ost: 'Windows', osn: 'Microsoft Windows Server 2019 Standard', dist: 'Windows Server', host: `HOST-${a}`, bu: 'Finance', reg: 'West Africa', crit: 'High', meth: 'tag_mapping', inet: false, sw: null, ...over };
  return [base.asset, base.cve, base.pcve, base.pid, base.score, base.kev, base.sla, base.prank, base.state, base.df, base.cls, base.ost, base.osn, base.dist, base.host, base.bu, base.reg, base.crit, base.meth, base.inet, base.sw] as Cell[];
};
const FINDINGS = synth(FCOLS, [
  F('A1', 'CVE-1', 90, { kev: true, sla: true, prank: 1, sw: 'Chrome' }),
  F('A1', 'CVE-1', 60, { pid: 2 }),                                              // same (asset, CVE): counts once, keeps the worst score
  F('A1', 'CVE-2', 85, { sw: 'Chrome' }),                                         // boundary: Critical
  F('A1', 'CVE-3', 84.9, { sw: 'Firefox' }),                                      // High
  F('A2', 'CVE-4', 70, { ost: 'Linux', osn: 'Ubuntu 22.04', dist: 'Ubuntu', host: 'HOST-A2', sw: 'Chrome' }), // boundary: High
  F('A2', 'CVE-5', 69.9, { ost: 'Linux', osn: 'Ubuntu 22.04', dist: 'Ubuntu', host: 'HOST-A2' }),            // Medium
  F('A2', 'CVE-6', 50, { ost: 'Linux', osn: 'Ubuntu 22.04', dist: 'Ubuntu', host: 'HOST-A2' }),              // boundary: Medium
  F('A2', 'CVE-7', 49.9, { ost: 'Linux', osn: 'Ubuntu 22.04', dist: 'Ubuntu', host: 'HOST-A2' }),            // Low
  F('A3', 'CVE-8', 95, { ost: 'Android', osn: 'Android 14', dist: null }),        // Android: excluded
  F('A4', 'CVE-9', 95, { ost: 'iOS', osn: 'iOS 17', dist: null }),                // iOS: excluded
  F('A1', 'CVE-10', 99, { state: 'FIXED' }),                                      // closed: excluded
  F('A2', 'CVE-11', 99, { state: null, df: 'Fixed', ost: 'Linux' }),              // Defender says Fixed: excluded
  F('A2', 'CVE-12', 99, { state: 'ACTIVE', df: 'Fixed', ost: 'Linux' }),          // Tenable open but Defender Fixed: excluded
  F('A5', 'CVE-13', 99, { cls: 'Workstation', host: 'WKS-A5' }),                   // not a server: not in server bands
]);
const ACOLS: Array<[string, string]> = [['gold_asset_id', 'STRING'], ['asset_class', 'STRING'], ['os_type', 'STRING'], ['os_name', 'STRING'], ['os_distribution', 'STRING']];
const ASSETS = synth(ACOLS, [
  ['A1', 'Server', 'Windows', 'Microsoft Windows Server 2019 Standard', 'Windows Server'], ['A1', 'Server', 'Windows', 'Microsoft Windows Server 2019 Standard', 'Windows Server'], // duplicate id
  ['A2', 'Server', 'Linux', 'Ubuntu 22.04', 'Ubuntu'], ['A3', 'Server', 'Android', 'Android 14', null], ['A4', 'Workstation', 'iOS', 'iOS 17', null],
  ['A5', 'Workstation', 'Windows', 'Windows 11', 'Windows'], ['A6', null, 'Windows', 'Windows 10', 'Windows'], ['A7', 'Server', 'Windows', 'Microsoft Windows Server 2012 R2 Standard', 'Windows Server'],
]);

run('executive sections: aggregation logic on controlled data', () => {
  beforeAll(async () => { await syncSchema(); }, 120_000);

  it('Section 1: distinct assets, servers, classes; Android / iOS excluded; Windows Server grouped by release', async () => {
    const t = (await run1('execTotals', ASSETS))[0];
    expect([n(t.total), n(t.servers)]).toEqual([5, 3]);        // A1 (once), A2, A5, A6, A7; A3 Android and A4 iOS excluded; servers A1, A2, A7
    const cls = Object.fromEntries((await run1('execByClass', ASSETS)).map((r) => [r.label, n(r.value)]));
    expect(cls).toEqual({ Server: 3, Workstation: 1, Unknown: 1 });
    const os = Object.fromEntries((await run1('execServersByOs', ASSETS)).map((r) => [r.label, n(r.value)]));
    expect(os).toEqual({ 'Windows Server 2019': 1, 'Windows Server 2012 R2': 1, Ubuntu: 1 });
  }, 180_000);

  it('Section 2: bands on the score thresholds, duplicates counted once, closed / Fixed / mobile / non-server excluded', async () => {
    const bands = Object.fromEntries((await run1('execServerBands', FINDINGS)).map((r) => [r.label, n(r.value)]));
    expect(bands).toEqual({ Critical: 2, High: 2, Medium: 2, Low: 1 });
    const k = (await run1('execServerKpis', FINDINGS))[0];
    expect([n(k.unique_vulns), n(k.servers_with_vulns), n(k.servers_kev), n(k.servers_breach)]).toEqual([7, 2, 1, 1]);
  }, 180_000);

  it('Section 2: a band with no data shows as 0 (Low is absent from the query, present as 0 in the chart)', async () => {
    const rows = await run1('execServerBands', FINDINGS, 'WHERE final_score >= 70');
    expect(rows.some((r) => r.label === 'Low')).toBe(false);
    expect(fillBands(rows.map((r) => ({ label: String(r.label), value: n(r.value) }))).map((r) => [r.label, r.value])).toEqual([['Critical', 2], ['High', 2], ['Medium', 0], ['Low', 0]]);
    expect(fillBands([]).every((r) => r.value === 0)).toBe(true);
  }, 180_000);

  it('Section 3: applications by unique vulnerabilities and by max score', async () => {
    const byCount = await run1('execAppsByCount', FINDINGS);
    expect(byCount.map((r) => [r.software_name, n(r.vulns), n(r.assets), n(r.kev), n(r.max_score)])).toEqual([['Chrome', 3, 2, 1, 90], ['Firefox', 1, 1, 0, 84.9]]);
    expect(n(byCount[0].prank)).toBe(1);
    const byScore = await run1('execAppsByScore', FINDINGS);
    expect(byScore.map((r) => r.software_name)).toEqual(['Chrome', 'Firefox']);
  }, 180_000);

  it('Section 4: top servers with per-band counts, KEV and max score, ordered by unique vulnerabilities', async () => {
    const rows = await run1('execTopServers', FINDINGS);
    const by = Object.fromEntries(rows.map((r) => [r.gold_asset_id, r]));
    expect(rows.map((r) => r.gold_asset_id)).toEqual(['A2', 'A1']);   // 4 unique vulnerabilities, then 3; A5 is a workstation
    expect([n(by.A1.total), n(by.A1.critical), n(by.A1.high), n(by.A1.medium), n(by.A1.low), n(by.A1.kev), n(by.A1.max_score)]).toEqual([3, 2, 1, 0, 0, 1, 90]);
    expect([n(by.A2.total), n(by.A2.critical), n(by.A2.high), n(by.A2.medium), n(by.A2.low), n(by.A2.kev)]).toEqual([4, 0, 1, 2, 1, 0]);
    expect(by.A2.os).toBe('Ubuntu');
    expect(by.A1.criticality).toBe('High');
  }, 180_000);
});

// ---------------------------------------------------------------- demo data vs independent SQL, under every new filter
const A = () => entityTable('assets');
const V = () => entityTable('vulnerabilities');
const assetsSql = () => `(SELECT * FROM (SELECT x.*, row_number() OVER (PARTITION BY gold_asset_id ORDER BY canonical_source_rank, source_rank, snapshot_timestamp DESC) rn FROM ${A()} x WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${A()}) AND snapshot_timestamp = (SELECT max(snapshot_timestamp) FROM ${A()} WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${A()})) AND NOT coalesce(is_purged, false) AND terminated_at IS NULL) WHERE rn = 1)`;
const openSql = () => `(SELECT f.* FROM ${V()} f WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${V()}) AND snapshot_timestamp = (SELECT max(snapshot_timestamp) FROM ${V()} WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${V()})) AND coalesce(deduplication_status,'Unique') <> 'Duplicate' AND coalesce(te_state, df_status) IS NOT NULL AND upper(coalesce(te_state, df_status)) NOT IN ('FIXED','RESOLVED','CLOSED') AND coalesce(upper(df_status),'') <> 'FIXED' AND gold_asset_id IN (SELECT gold_asset_id FROM ${assetsSql()}))`;
const noMobile = (a: string) => `lower(coalesce(${a}.os_type,'')) NOT IN ('android','ios')`;
const one = async (sql: string) => n(Object.values((await query(sql))[0] ?? {})[0]);

async function w(id: string, filters: Partial<typeof EMPTY_FILTERS> = {}) {
  const def = WIDGET_BY_ID.get(id)!;
  const f = { ...EMPTY_FILTERS, ...filters };
  const { where, params } = widgetScope(def.entity, filtersToTree(f), [...(f.extra ?? []), ...derivedExtras(f)] as ExtraFilter[], { latestSnapshotOnly: true });
  return query(def.sql(makeCtx(canonicalSource(def.entity), where)), params);
}
// direct SQL for "server pairs", with optional restriction on the asset / finding
const serverPairs = (assetWhere = 'true', findingWhere = 'true') => `(SELECT o.gold_asset_id AS asset, coalesce(o.cve, o.plugin_cve, cast(o.plugin_id AS string), 'unknown') AS k, max(o.final_score) AS score, max(CASE WHEN coalesce(o.kev_flag,false) THEN 1 ELSE 0 END) AS kev FROM ${openSql()} o JOIN ${assetsSql()} a ON a.gold_asset_id = o.gold_asset_id WHERE lower(a.asset_class) = 'server' AND ${noMobile('a')} AND ${assetWhere} AND ${findingWhere} GROUP BY 1, 2)`;
const bandOf = (s: string) => `CASE WHEN ${s} >= 85 THEN 'Critical' WHEN ${s} >= 70 THEN 'High' WHEN ${s} >= 50 THEN 'Medium' WHEN ${s} IS NOT NULL THEN 'Low' END`;

const SCENARIOS: Array<[string, Partial<typeof EMPTY_FILTERS>, string, string]> = [
  ['no filters', {}, 'true', 'true'],
  ['region = West Africa', { region: ['West Africa'] }, `a.region = 'West Africa'`, 'true'],
  ['business unit = IT Operations', { business_unit: ['IT Operations'] }, `a.business_unit = 'IT Operations'`, 'true'],
  ['asset criticality = Critical', { criticality: ['Critical'] }, `a.criticality = 'Critical'`, 'true'],
  ['VOC priority = P1', { priority: ['P1'] }, 'true', `o.priority_code = 'P1'`],
  ['OS family = Linux', { os_family: ['Linux'] }, `a.os_type = 'Linux'`, 'true'],
  ['KEV = yes', { kev: 'yes' }, 'true', 'coalesce(o.kev_flag, false)'],
];

run('executive sections: every number responds to every filter (demo data vs independent SQL)', () => {
  beforeAll(async () => { await syncSchema(); }, 120_000);

  for (const [name, filters, aw, fw] of SCENARIOS) {
    it(`server bands and KPIs under: ${name}`, async () => {
      const direct = Object.fromEntries((await query(`SELECT ${bandOf('score')} AS b, count(*) AS c FROM ${serverPairs(aw, fw)} GROUP BY 1`)).filter((r) => r.b).map((r) => [r.b, n(r.c)]));
      const got = Object.fromEntries((await w('execServerBands', filters)).map((r) => [r.label, n(r.value)]));
      expect(got).toEqual(direct);
      const k = (await w('execServerKpis', filters))[0];
      expect(n(k.unique_vulns)).toBe(Object.values(direct).reduce((s, x) => s + n(x), 0));
      expect(n(k.servers_kev)).toBe(await one(`SELECT count(DISTINCT asset) FROM ${serverPairs(aw, fw)} WHERE kev = 1`));
    }, 300_000);
  }

  it('asset overview, apps and top servers respond to the filters (checked against direct SQL)', async () => {
    for (const [name, filters, aw, fw] of SCENARIOS.slice(1)) {
      // asset-level filters apply directly; finding-level filters keep assets that have an open matching finding
      const hasFinding = fw === 'true' ? 'true' : `EXISTS (SELECT 1 FROM ${openSql()} o WHERE o.gold_asset_id = a.gold_asset_id AND ${fw})`;
      const totals = (await w('execTotals', filters))[0];
      expect(n(totals.total), `total assets: ${name}`).toBe(await one(`SELECT count(DISTINCT a.gold_asset_id) FROM ${assetsSql()} a WHERE ${noMobile('a')} AND ${aw} AND ${hasFinding}`));
      expect(n(totals.servers), `servers: ${name}`).toBe(await one(`SELECT count(DISTINCT a.gold_asset_id) FROM ${assetsSql()} a WHERE lower(a.asset_class) = 'server' AND ${noMobile('a')} AND ${aw} AND ${hasFinding}`));
      const topServer = (await w('execTopServers', filters))[0];
      const directTop = (await query(`SELECT asset, count(*) AS total FROM ${serverPairs(aw, fw)} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`))[0];
      if (directTop) expect(n(topServer.total), `top server: ${name}`).toBe(n(directTop.total)); else expect(topServer).toBeUndefined();
      const app = (await w('execAppsByCount', filters))[0];
      const directApp = (await query(`SELECT software, count(*) AS vulns FROM (SELECT o.software_name AS software, o.gold_asset_id AS asset, coalesce(o.cve, o.plugin_cve, cast(o.plugin_id AS string), 'unknown') AS k FROM ${openSql()} o JOIN ${assetsSql()} a ON a.gold_asset_id = o.gold_asset_id WHERE ${noMobile('a')} AND o.software_name IS NOT NULL AND ${aw} AND ${fw} GROUP BY 1, 2, 3) GROUP BY 1 ORDER BY 2 DESC, count(DISTINCT asset) DESC LIMIT 1`))[0];
      if (directApp) expect(n(app.vulns), `top app: ${name}`).toBe(n(directApp.vulns)); else expect(app).toBeUndefined();
    }
  }, 900_000);

  it('Android / iOS never appear, even when you filter for them', async () => {
    const mobile = (await w('execTotals', { os_family: ['Android', 'iOS'] }))[0];
    expect(n(mobile.total)).toBe(0);
    expect((await w('execServerBands', { os_family: ['Android', 'iOS'] })).length).toBe(0);
  }, 180_000);

  it('an empty result is an empty result, not an error (all bands 0)', async () => {
    const rows = await w('execServerBands', { region: ['Nowhere'] });
    expect(fillBands(rows.map((r) => ({ label: String(r.label), value: n(r.value) }))).every((r) => r.value === 0)).toBe(true);
    expect((await w('execTopServers', { region: ['Nowhere'] })).length).toBe(0);
  }, 180_000);
});
