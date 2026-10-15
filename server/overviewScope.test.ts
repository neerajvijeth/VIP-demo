import { describe, expect, it } from 'vitest';
import type { Condition, ExtraFilter, Group } from '../shared/types';
import { cleanExtras, widgetScope } from './overviewScope';

const cond = (field: string, operator: string, value: any = null): Condition => ({ type: 'condition', field, operator, value, not: false });
const x = (entity: 'assets' | 'vulnerabilities', c: Condition, id = 'x'): ExtraFilter => ({ id, entity, condition: c });
const tree = (children: Condition[] = []): Group => ({ type: 'group', op: 'AND', not: false, children });
const opts = { latestSnapshotOnly: true };

describe('Overview extra filters', () => {
  it('a filter on the widget\'s own table is AND-ed directly (values bound)', () => {
    const r = widgetScope('assets', tree(), [x('assets', cond('os_name', 'contains', 'Windows'))], opts);
    expect(r.where).toContain('`os_name`');
    expect(r.where).not.toContain('Windows');
    expect(Object.values(r.params)).toContain('%Windows%');
    expect(r.where).not.toContain(' IN (SELECT');
  });
  it('asset filter on a FINDINGS widget: findings whose asset matches (semi-join on the asset id)', () => {
    const r = widgetScope('vulnerabilities', tree(), [x('assets', cond('os_name', 'contains', 'Windows'))], opts);
    expect(r.where).toMatch(/`gold_asset_id` IN \(SELECT `gold_asset_id` FROM \(SELECT \* EXCEPT \(_rn\)/);
    expect(r.where).toContain('`os_name`');
    expect(r.where).not.toContain('Windows');
  });
  it('finding filter on an ASSETS widget: assets that have an OPEN matching finding', () => {
    const r = widgetScope('assets', tree(), [x('vulnerabilities', cond('severity', 'is', 'Critical'))], opts);
    expect(r.where).toMatch(/`gold_asset_id` IN \(SELECT `gold_asset_id` FROM \(SELECT f\.\*/);
    expect(r.where).toContain("NOT IN ('FIXED', 'RESOLVED', 'CLOSED')");
    expect(Object.values(r.params)).toContain('Critical');
  });
  it('parameters from the fixed filters, own filters and the bridge never collide', () => {
    const r = widgetScope('assets', tree([cond('region', 'is', 'West Africa')]), [x('assets', cond('os_name', 'contains', 'Linux')), x('vulnerabilities', cond('severity', 'is', 'High'))], opts);
    const keys = Object.keys(r.params);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.values(r.params)).toEqual(expect.arrayContaining(['West Africa', '%Linux%', 'High']));
  });
  it('the snapshot switch applies inside the bridge too', () => {
    expect(widgetScope('assets', tree(), [x('vulnerabilities', cond('severity', 'is', 'High'))], { latestSnapshotOnly: true }).where).toContain('MAX(`snapshot_date`)');
    const off = widgetScope('assets', tree(), [x('vulnerabilities', cond('severity', 'is', 'High'))], { latestSnapshotOnly: false }).where;
    expect(off).not.toContain('MAX(`snapshot_date`)');
  });
  it('never applies is_valid', () => {
    expect(widgetScope('vulnerabilities', tree(), [x('assets', cond('os_name', 'contains', 'a'))], { latestSnapshotOnly: true, validOnly: true } as any).where).not.toContain('is_valid');
  });
});

describe('Overview extra filters are validated before any query runs', () => {
  const bad = (v: unknown) => expect(() => cleanExtras(v)).toThrow();
  it('rejects unknown fields, bad operators, injection in field/operator, wrong entity, wrong shape', () => {
    bad([x('assets', cond('no_such_column', 'is', 'a'))]);
    bad([x('assets', cond('hostname`; DROP TABLE t; --', 'is', 'a'))]);
    bad([x('assets', cond('hostname', 'is; DROP TABLE t', 'a'))]);
    bad([x('assets', cond('os_major_version', 'contains', 'x'))]);     // text operator on a number
    bad([x('vulnerabilities', cond('kev_flag', 'is true'), 'a'), { id: 'b', entity: 'users', condition: cond('a', 'is', 'b') }]);
    bad([{ id: 'a', entity: 'assets', condition: { type: 'group' } }]);
    bad('assets');
    bad(Array.from({ length: 21 }, (_, i) => x('assets', cond('hostname', 'is', 'a'), String(i))));
  });
  it('keeps valid filters and tolerates none', () => {
    expect(cleanExtras(undefined)).toEqual([]);
    expect(cleanExtras([])).toEqual([]);
    const ok = cleanExtras([x('assets', cond('os_major_version', '≥', 10)), x('vulnerabilities', cond('kev_flag', 'is true'))]);
    expect(ok.map((e) => e.entity)).toEqual(['assets', 'vulnerabilities']);
  });
  it('values are bound, never concatenated (quotes survive)', () => {
    const r = widgetScope('assets', tree(), [x('assets', cond('hostname', 'is', "o'brien'; DROP TABLE x"))], opts);
    expect(r.where).not.toContain('DROP');
    expect(Object.values(r.params)).toContain("o'brien'; DROP TABLE x");
  });
});
