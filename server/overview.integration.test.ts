/** Live-warehouse check of the Overview numbers: VIP_IT=1 npx vitest run server/overview.integration */
import { beforeAll, describe, expect, it } from 'vitest';
import { filtersToTree } from '../shared/filters';
import { EMPTY_FILTERS } from '../shared/types';
import { entityTable } from './config';
import { query } from './db';
import { syncSchema } from './schema';
import { buildWhere } from './sqlBuilder';
import { WIDGET_BY_ID, makeCtx } from './overviewWidgets';
import { canonicalSource } from './overviewSource';

const run = process.env.VIP_IT ? describe : describe.skip;
const A = () => entityTable('assets');
const V = () => entityTable('vulnerabilities');
const OPTS = { latestSnapshotOnly: true, validOnly: true };

async function widget(id: string, filters: Partial<typeof EMPTY_FILTERS> = {}) {
  const def = WIDGET_BY_ID.get(id)!;
  const { where, params } = buildWhere(def.entity, filtersToTree({ ...EMPTY_FILTERS, ...filters }), OPTS);
  return query(def.sql(makeCtx(canonicalSource(def.entity), where)), params);
}
const n = (v: unknown) => Number(v);
const sum = (rows: Record<string, any>[]) => rows.reduce((s, r) => s + n(r.value), 0);

// Independent definitions, written differently from the app's source
const latestAssets = `(SELECT * FROM (SELECT x.*, row_number() OVER (PARTITION BY gold_asset_id ORDER BY canonical_source_rank, source_rank, snapshot_timestamp DESC) rn FROM ${'${A}'} x WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${'${A}'}) AND snapshot_timestamp = (SELECT max(snapshot_timestamp) FROM ${'${A}'} WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${'${A}'})) AND is_valid AND NOT coalesce(is_purged, false) AND terminated_at IS NULL) WHERE rn = 1)`;
const assetsSql = () => latestAssets.replaceAll('${A}', A());
const openSql = () => `(SELECT f.* FROM ${V()} f WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${V()}) AND snapshot_timestamp = (SELECT max(snapshot_timestamp) FROM ${V()} WHERE snapshot_date = (SELECT max(snapshot_date) FROM ${V()})) AND is_valid AND coalesce(deduplication_status,'Unique') <> 'Duplicate' AND coalesce(te_state, df_status) IS NOT NULL AND upper(coalesce(te_state, df_status)) NOT IN ('FIXED','RESOLVED','CLOSED') AND gold_asset_id IN (SELECT gold_asset_id FROM ${assetsSql()}))`;
const one = async (sql: string) => n(Object.values((await query(sql))[0] ?? {})[0]);

run('Overview numbers (live warehouse)', () => {
  beforeAll(async () => { await syncSchema(); }, 120_000);

  it('headline cards equal direct SQL and are non-zero', async () => {
    const [assets, open, kev, ch, breached, exposed] = await Promise.all([
      one(`SELECT count(*) FROM ${assetsSql()}`), one(`SELECT count(*) FROM ${openSql()}`), one(`SELECT count(*) FROM ${openSql()} WHERE coalesce(kev_flag,false)`),
      one(`SELECT count(*) FROM ${openSql()} WHERE severity IN ('Critical','High')`), one(`SELECT count(*) FROM ${openSql()} WHERE coalesce(sla_breached,false)`),
      one(`SELECT count(DISTINCT o.gold_asset_id) FROM ${openSql()} o JOIN ${assetsSql()} a ON a.gold_asset_id = o.gold_asset_id WHERE coalesce(a.internet_exposed,false) AND o.severity IN ('Critical','High')`),
    ]);
    expect(n((await widget('kpiTotalAssets'))[0].value)).toBe(assets);
    expect(n((await widget('kpiOpenVulns'))[0].value)).toBe(open);
    expect(n((await widget('kpiKev'))[0].value)).toBe(kev);
    expect(n((await widget('kpiCritHigh'))[0].value)).toBe(ch);
    const sla = (await widget('kpiSla'))[0];
    expect([n(sla.total), n(sla.breached)]).toEqual([open, breached]);
    expect(n((await widget('kpiExposedCritHigh'))[0].value)).toBe(exposed);
    for (const v of [assets, open, kev, ch]) expect(v).toBeGreaterThan(0);
  }, 240_000);

  it('every distribution adds up to its headline number (Unknown buckets included)', async () => {
    const open = n((await widget('kpiOpenVulns'))[0].value);
    for (const id of ['severityDonut', 'slaStatus', 'ageBuckets']) expect(sum(await widget(id)), id).toBe(open);
    expect(sum(await widget('riskByBusinessUnit'))).toBe(open);
    const assets = n((await widget('kpiTotalAssets'))[0].value);
    for (const id of ['assetsByClass', 'assetsByCriticality', 'toolVisibility']) expect(sum(await widget(id)), id).toBe(assets);
    const cov = (await widget('coverage'))[0];
    expect(n(cov.with_agent) + n(cov.without_agent) + n(cov.unknown_agent)).toBe(assets);
  }, 240_000);

  it('top-10 tables show real, non-zero Vulns / KEV / Findings and a name for every vulnerability', async () => {
    const assets = await widget('topAssets');
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((r) => n(r.vulns) > 0)).toBe(true);
    expect(assets.some((r) => n(r.kev) > 0)).toBe(true);
    const vulns = await widget('topVulns');
    expect(vulns.every((r) => r.vulnerability_name && r.cve && n(r.assets) > 0 && n(r.findings) > 0)).toBe(true);
  }, 240_000);

  it('a global filter applies to assets and findings consistently (asset attributes come from the asset row)', async () => {
    const f = { asset_class: ['Server'] };
    const servers = n((await widget('kpiTotalAssets', f))[0].value);
    expect(servers).toBe(await one(`SELECT count(*) FROM ${assetsSql()} WHERE asset_class = 'Server'`));
    const open = n((await widget('kpiOpenVulns', f))[0].value);
    expect(open).toBe(await one(`SELECT count(*) FROM ${openSql()} o JOIN ${assetsSql()} a ON a.gold_asset_id = o.gold_asset_id WHERE a.asset_class = 'Server'`));
    expect(open).toBeLessThan(n((await widget('kpiOpenVulns'))[0].value));
  }, 240_000);
});
