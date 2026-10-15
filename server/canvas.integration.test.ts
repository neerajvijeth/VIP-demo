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

  it('rejects unknown / malicious columns and non-numeric sums before any SQL runs', async () => {
    await expect(C.chartData(SQL, { type: 'bar', dimension: 'region` ; DROP TABLE x --', measure: { agg: 'count' } })).rejects.toThrow(/Unknown dimension/);
    await expect(C.chartData(SQL, { type: 'bar', dimension: 'region', measure: { agg: 'sum', column: 'hostname' } })).rejects.toThrow(/numeric/);
    await expect(C.chartData(SQL, { type: 'bar', measure: { agg: 'count' } })).rejects.toThrow(/Choose a dimension/);
  }, 120_000);
});
