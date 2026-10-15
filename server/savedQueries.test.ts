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
