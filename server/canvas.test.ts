import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

let C: typeof import('./canvas');
let S: typeof import('./savedQueries');
beforeAll(async () => {
  process.env.VIP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vip-canvas-'));
  S = await import('./savedQueries');
  C = await import('./canvas');
});

const tile = (queryId: string, over: any = {}) => ({ id: 't' + Math.random().toString(36).slice(2), query_id: queryId, query_version: 'latest', title: 'T', chart: { type: 'donut', dimension: 'region', measure: { agg: 'count' } }, w: 6, h: 3, ...over });

describe('chart validation', () => {
  it('accepts every chart type and rejects unknown types / aggregations / bad top N', () => {
    for (const type of ['bar', 'hbar', 'stacked', 'line', 'area', 'donut', 'table', 'kpi']) expect(C.cleanChart({ type, measure: { agg: 'count' } }).type).toBe(type);
    expect(() => C.cleanChart({ type: 'pie3d', measure: { agg: 'count' } })).toThrow();
    expect(() => C.cleanChart({ type: 'bar', measure: { agg: 'median' } })).toThrow();
    expect(() => C.cleanChart({ type: 'bar', measure: { agg: 'count' }, top_n: 0 })).toThrow();
    expect(() => C.cleanChart({ type: 'bar', measure: { agg: 'count' }, top_n: 5000 })).toThrow();
    expect(() => C.cleanChart(null)).toThrow();
  });
  it('numeric type detection', () => {
    for (const t of ['int', 'bigint', 'double', 'decimal(10,2)', 'float', 'smallint', 'tinyint']) expect(C.isNumeric(t), t).toBe(true);
    for (const t of ['string', 'date', 'timestamp', 'boolean', 'array<int>']) expect(C.isNumeric(t), t).toBe(false);
  });
});

describe('canvases', () => {
  it('create / read / update / duplicate / delete with owner-only edits and team sharing', async () => {
    const c = await C.create({ name: 'Ops', tiles: [tile('q1')] }, 'ann');
    expect(C.get(c.id, 'ann').tiles).toHaveLength(1);
    expect(() => C.get(c.id, 'bob')).toThrow(/not found/);              // private
    await C.update(c.id, { visibility: 'team' }, 'ann');
    expect(C.get(c.id, 'bob').name).toBe('Ops');                          // shared: readable
    await expect(C.update(c.id, { name: 'x' }, 'bob')).rejects.toThrow(/owner/);
    await expect(C.remove(c.id, 'bob')).rejects.toThrow(/owner/);
    const d = await C.duplicate(c.id, 'bob');
    expect(d.owner).toBe('bob');
    expect(d.visibility).toBe('private');
    expect(d.tiles[0].id).not.toBe(c.tiles[0].id);
    const u = await C.update(c.id, { tiles: [tile('q1'), tile('q2', { w: 12, h: 6 })] }, 'ann');
    expect(u.tiles.map((t) => [t.w, t.h])).toEqual([[6, 3], [12, 6]]);
    await C.remove(c.id, 'ann');
    expect(() => C.get(c.id, 'ann')).toThrow();
  });
  it('rejects bad input: empty name, too many tiles, bad chart, bad version', async () => {
    await expect(C.create({ name: '  ' }, 'ann')).rejects.toThrow(/name/);
    await expect(C.create({ name: 'x', tiles: Array.from({ length: 41 }, () => tile('q')) }, 'ann')).rejects.toThrow(/at most 40/);
    await expect(C.create({ name: 'x', tiles: [tile('q', { chart: { type: 'nope' } })] }, 'ann')).rejects.toThrow();
    await expect(C.create({ name: 'x', tiles: [tile('q', { query_version: -2 })] }, 'ann')).rejects.toThrow();
  });
  it('normalises odd layout values instead of storing them', async () => {
    const c = await C.create({ name: 'n', tiles: [tile('q', { w: 7, h: 99 })] }, 'ann');
    expect([c.tiles[0].w, c.tiles[0].h]).toEqual([6, 3]);
  });
});

describe('tile access follows the saved query', () => {
  it('a tile whose query is private to someone else (or deleted) shows no_access, not data', async () => {
    const q = await S.create({ name: 'secret', sql: 'SELECT 1 AS n' }, 'ann');
    const r = await C.runTile({ query_id: q.id, query_version: 'latest', chart: { type: 'kpi', measure: { agg: 'count' } } }, 'bob');
    expect(r.state).toBe('no_access');
    const gone = await C.runTile({ query_id: 'missing', query_version: 'latest', chart: { type: 'kpi', measure: { agg: 'count' } } }, 'ann');
    expect(gone.state).toBe('no_access');
  });
  it('a pinned version that does not exist is reported, not silently replaced by latest', async () => {
    const q = await S.create({ name: 'v', sql: 'SELECT 1 AS n' }, 'ann');
    const r = await C.runTile({ query_id: q.id, query_version: 7, chart: { type: 'kpi', measure: { agg: 'count' } } }, 'ann');
    expect(r.state).toBe('no_access');
    expect((r as any).message).toMatch(/Version 7/);
  });
});
