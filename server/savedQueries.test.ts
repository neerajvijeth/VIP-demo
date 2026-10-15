import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

let S: typeof import('./savedQueries');
beforeAll(async () => {
  process.env.VIP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vip-'));
  S = await import('./savedQueries');
});

describe('saved queries', () => {
  it('round-trips, versions on SQL change, and rolls back', async () => {
    const q = await S.create({ name: 'a', sql: 'SELECT 1 AS n' }, 'ann');
    expect(q.version).toBe(1);
    expect(S.get(q.id, 'ann').current.sql).toBe('SELECT 1 AS n');
    const q2 = await S.update(q.id, { sql: 'SELECT 2 AS n' }, 'ann');
    expect(q2.version).toBe(2);
    expect((await S.update(q.id, { name: 'renamed' }, 'ann')).version).toBe(2); // rename is not a new version
    const q3 = await S.rollback(q.id, 1, 'ann');
    expect(q3.version).toBe(3);
    expect(q3.sql).toBe('SELECT 1 AS n');
    expect(S.versions(q.id, 'ann').map((v) => v.version)).toEqual([3, 2, 1]);
  });
  it('private is invisible to others; team is readable but only the owner edits', async () => {
    const p = await S.create({ name: 'p', sql: 'SELECT 1' }, 'ann');
    expect(() => S.get(p.id, 'bob')).toThrow(/not found/);
    const t = await S.create({ name: 't', sql: 'SELECT 1', visibility: 'team' }, 'ann');
    expect(S.get(t.id, 'bob').current.name).toBe('t');
    await expect(S.update(t.id, { name: 'x' }, 'bob')).rejects.toThrow(/owner/);
    await expect(S.remove(t.id, 'bob')).rejects.toThrow(/owner/);
    expect(S.list('bob').some((x) => x.id === t.id)).toBe(true);
    expect(S.list('bob').some((x) => x.id === p.id)).toBe(false);
    const d = await S.duplicate(t.id, 'bob');
    expect(d.owner).toBe('bob');
    expect(d.visibility).toBe('private');
  });
  it('rejects DDL/DML and statement chains on save and on edit', async () => {
    for (const sql of ['DROP TABLE x', 'DELETE FROM t', 'SELECT 1; DROP TABLE x', 'INSERT INTO t SELECT 1']) await expect(S.create({ name: 'bad', sql }, 'ann'), sql).rejects.toThrow();
    const q = await S.create({ name: 'ok', sql: 'SELECT 1' }, 'ann');
    await expect(S.update(q.id, { sql: 'DROP TABLE x' }, 'ann')).rejects.toThrow();
    await expect(S.create({ name: '', sql: 'SELECT 1' }, 'ann')).rejects.toThrow(/name/);
  });
});

describe('builder (Assets / Vulnerabilities) queries', () => {
  const payload = (over: any = {}) => ({ tree: { type: 'group', op: 'AND', not: false, children: [{ type: 'condition', field: 'asset_class', operator: 'is', value: 'Server', not: false }] }, columns: ['hostname', 'asset_class'], sort: null, options: { latestSnapshotOnly: true, validOnly: true }, mode: 'rows', ...over });
  it('stores the typed spec (never SQL) and regenerates parameterised SQL on resolve', async () => {
    const { resolve } = await import('./savedResolve');
    const q = await S.create({ kind: 'builder', entity: 'assets', name: 'servers', payload: payload(), sql: 'DROP TABLE x' }, 'ann');
    expect(q.kind).toBe('builder');
    expect(q.sql).toBe('');
    const r = resolve(q);
    expect(r.sql).toMatch(/SELECT .*hostname.*FROM/s);
    expect(Object.values(r.params)).toContain('Server');
    expect(r.sql).not.toContain('Server');
  });
  it('summary mode resolves to a labelled aggregate', async () => {
    const { resolve } = await import('./savedResolve');
    const q = await S.create({ kind: 'builder', entity: 'assets', name: 'by bu', payload: payload({ mode: 'summary', summary: { groupBy: [{ field: 'business_unit' }], metrics: [{ fn: 'count_distinct', field: 'gold_asset_id' }], sort: null, limit: 50 } }) }, 'ann');
    expect(resolve(q).sql).toMatch(/AS `Business Unit`/);
  });
  it('rejects an invalid spec on save and on edit (unknown field, bad operator, missing tree, wrong entity)', async () => {
    const bad = (p: any, entity: any = 'assets') => expect(S.create({ kind: 'builder', entity, name: 'bad', payload: p }, 'ann')).rejects.toThrow();
    await bad(payload({ tree: { type: 'group', op: 'AND', not: false, children: [{ type: 'condition', field: 'no_such_col`;--', operator: 'is', value: 'x', not: false }] } }));
    await bad(payload({ tree: { type: 'group', op: 'AND', not: false, children: [{ type: 'condition', field: 'asset_class', operator: 'is; DROP', value: 'x', not: false }] } }));
    await bad({ columns: [] });
    await bad(payload(), 'users');
    const q = await S.create({ kind: 'builder', entity: 'assets', name: 'ok', payload: payload() }, 'ann');
    await expect(S.update(q.id, { payload: { tree: { type: 'group', op: 'AND', not: false, children: [{ type: 'condition', field: 'nope', operator: 'is', value: 'x', not: false }] } } }, 'ann')).rejects.toThrow();
  });
  it('a payload change makes version n+1 and rollback restores it; a rename does not', async () => {
    const q = await S.create({ kind: 'builder', entity: 'assets', name: 'v', payload: payload() }, 'ann');
    const changed = payload({ columns: ['hostname'] });
    expect((await S.update(q.id, { name: 'renamed' }, 'ann')).version).toBe(1);
    expect((await S.update(q.id, { payload: changed }, 'ann')).version).toBe(2);
    expect((await S.update(q.id, { payload: changed }, 'ann')).version).toBe(2); // same payload: no new version
    const rb = await S.rollback(q.id, 1, 'ann');
    expect(rb.version).toBe(3);
    expect(rb.payload?.columns).toEqual(['hostname', 'asset_class']);
  });
  it('records saved before builder queries existed read as SQL; duplicate keeps the kind', async () => {
    const q = await S.create({ kind: 'builder', entity: 'vulnerabilities', name: 'vv', payload: payload({ columns: null }) }, 'ann');
    const d = await S.duplicate(q.id, 'ann');
    expect(d.kind).toBe('builder');
    expect(d.entity).toBe('vulnerabilities');
    expect(S.list('ann').every((x) => x.kind === 'sql' || x.kind === 'builder')).toBe(true);
  });
});
