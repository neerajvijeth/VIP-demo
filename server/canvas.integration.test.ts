/** Live-warehouse checks for chart data: VIP_IT=1 npx vitest run server/canvas.integration */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { config } from './config';
import { query } from './db';

const run = process.env.VIP_IT ? describe : describe.skip;
let C: typeof import('./canvas');
const T = `${config.catalog}.${config.schema}.gold_assets`;
// trailing line comment on purpose: the wrapper must survive it
const SQL = `SELECT hostname, asset_class, region, business_unit, last_seen_age, snapshot_date FROM ${T} WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ${T}) -- latest`;

run('canvas charts (live warehouse)', () => {
  beforeAll(async () => { process.env.VIP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vip-canvas-it-')); C = await import('./canvas'); });

  it('donut total equals the saved query row count, grouped numbers equal direct SQL', async () => {
    const rows = (await query(SQL)).length;
    const d = await C.chartData(SQL, { type: 'donut', dimension: 'asset_class', measure: { agg: 'count' } });
    expect(d.total).toBe(rows);
    const direct = await query(`SELECT asset_class AS k, count(*) AS n FROM (${SQL}\n) q GROUP BY 1`);
    for (const r of direct) expect(d.rows.find((x) => x.label === String(r.k))?.value).toBe(Number(r.n));
  }, 120_000);

  it('top N folds the tail into Other without changing the total', async () => {
    const all = await C.chartData(SQL, { type: 'bar', dimension: 'business_unit', measure: { agg: 'count' } });
    const top = await C.chartData(SQL, { type: 'bar', dimension: 'business_unit', measure: { agg: 'count' }, top_n: 2, other: true });
    expect(top.rows).toHaveLength(3);
    expect(top.rows[2].label).toBe('Other');
    expect(top.total).toBe(all.total);
  }, 120_000);

  it('stacked, average, distinct, kpi, line and table all run and agree', async () => {
    const st = await C.chartData(SQL, { type: 'stacked', dimension: 'region', split: 'asset_class', measure: { agg: 'count' } });
    expect(st.total).toBe((await C.chartData(SQL, { type: 'kpi', measure: { agg: 'count' } })).rows[0].value);
    const avg = await C.chartData(SQL, { type: 'hbar', dimension: 'asset_class', measure: { agg: 'avg', column: 'last_seen_age' } });
    expect(avg.rows.every((r) => typeof r.value === 'number')).toBe(true);
    const dist = await C.chartData(SQL, { type: 'kpi', measure: { agg: 'count_distinct', column: 'hostname' } });
    expect(dist.rows[0].value).toBeGreaterThan(0);
    expect((await C.chartData(SQL, { type: 'line', dimension: 'snapshot_date', measure: { agg: 'count' } })).rows.length).toBeGreaterThan(0);
    const tbl = await C.chartData(SQL, { type: 'table', measure: { agg: 'count' } });
    expect(tbl.columns.map((c) => c.name)).toContain('hostname');
  }, 240_000);

  it('Assets-page (builder) queries chart too: parameterised filter, total equals the page row count', async () => {
    const { resolve } = await import('./savedResolve');
    const { buildCount } = await import('./sqlBuilder');
    const { syncSchema } = await import('./schema');
    await syncSchema();
    const payload = { tree: { type: 'group', op: 'AND', not: false, children: [{ type: 'condition', field: 'asset_class', operator: 'is', value: 'Server', not: false }] }, columns: ['hostname', 'region', 'asset_class'], sort: null, options: { latestSnapshotOnly: true, validOnly: true }, mode: 'rows' };
    const r = resolve({ kind: 'builder', entity: 'assets', payload: payload as any });
    expect(Object.keys(r.params).length).toBeGreaterThan(0);
    const page = buildCount({ entity: 'assets', tree: payload.tree as any, options: payload.options });
    const expected = Number((await query(page.sql, page.params))[0].total);
    const d = await C.chartData(r, { type: 'donut', dimension: 'region', measure: { agg: 'count' } });
    expect(d.total).toBe(expected);
    expect(d.columns.map((c) => c.name)).toEqual(['hostname', 'region', 'asset_class']);
    // summary-mode queries expose human labels as columns
    const sum = resolve({ kind: 'builder', entity: 'assets', payload: { ...payload, mode: 'summary', summary: { groupBy: [{ field: 'business_unit' }], metrics: [{ fn: 'count_distinct', field: 'gold_asset_id' }], sort: null, limit: 50 } } as any });
    const s = await C.chartData(sum, { type: 'bar', dimension: 'Business Unit', measure: { agg: 'sum', column: (await C.columnsOf(sum)).find((c) => C.isNumeric(c.type))!.name } });
    expect(s.total).toBe(expected); // each asset has one business unit, so the per-BU distinct counts add up to the filtered asset count
  }, 240_000);

  it('rejects unknown / malicious columns and non-numeric sums before any SQL runs', async () => {
    await expect(C.chartData(SQL, { type: 'bar', dimension: 'region` ; DROP TABLE x --', measure: { agg: 'count' } })).rejects.toThrow(/Unknown dimension/);
    await expect(C.chartData(SQL, { type: 'bar', dimension: 'region', measure: { agg: 'sum', column: 'hostname' } })).rejects.toThrow(/numeric/);
    await expect(C.chartData(SQL, { type: 'bar', measure: { agg: 'count' } })).rejects.toThrow(/Choose a dimension/);
  }, 120_000);
});
