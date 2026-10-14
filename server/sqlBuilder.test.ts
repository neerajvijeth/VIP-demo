import { describe, it, expect } from 'vitest';
import type { Group, Node } from '../shared/types';
import { buildWhere, buildRun, buildExport, buildCount, buildDetail, buildSummary, BuilderError, LIMITS } from './sqlBuilder';
import { filtersToTree } from '../shared/filters';
import { EMPTY_FILTERS } from '../shared/types';

const cond = (field: string, operator: string, value: any = null, not = false): Node => ({ type: 'condition', field, operator, value, not });
const grp = (op: 'AND' | 'OR', children: Node[], not = false): Group => ({ type: 'group', op, not, children });
const V = 'vulnerabilities' as const;
const off = { latestSnapshotOnly: false, validOnly: false };

describe('structure', () => {
  it('empty tree yields no filter', () => {
    expect(buildWhere(V, grp('AND', []), off).where).toBe('WHERE TRUE');
  });
  it('empty groups are ignored', () => {
    const r = buildWhere(V, grp('AND', [grp('OR', []), cond('kev_flag', 'is true')]), off);
    expect(r.where).toBe('WHERE ((`kev_flag` = true))');
  });
  it('nested AND/OR/NOT with correct parentheses', () => {
    const tree = grp('AND', [
      grp('AND', [cond('severity', 'is one of', ['Critical', 'High']), cond('kev_flag', 'is true')]),
      grp('AND', [cond('business_unit', 'is', 'Lab')], true),
    ]);
    const r = buildWhere(V, tree, off);
    expect(r.where).toBe('WHERE (((`severity` IN (:p0, :p1) AND `kev_flag` = true) AND NOT (`business_unit` = :p2)))');
    expect(r.params).toEqual({ p0: 'Critical', p1: 'High', p2: 'Lab' });
  });
  it('condition NOT is null-safe', () => {
    const r = buildWhere(V, grp('AND', [cond('severity', 'is', 'Low', true)]), off);
    expect(r.where).toContain('NOT (COALESCE(`severity` = :p0, FALSE))');
  });
  it('appends snapshot and validity scope with AND and wraps the user tree', () => {
    const r = buildWhere('assets', grp('OR', [cond('hostname', 'contains', 'x')]), { latestSnapshotOnly: true, validOnly: true });
    expect(r.where).toMatch(/^WHERE `snapshot_date` = \(SELECT MAX\(`snapshot_date`\) FROM `[\w-]+`\.`[\w-]+`\.`gold_assets`\) AND `is_valid` = true AND \(\(/);
  });
  it('enforces depth and condition limits', () => {
    let t: Group = grp('AND', [cond('kev_flag', 'is true')]);
    for (let i = 0; i < LIMITS.maxDepth + 1; i++) t = grp('AND', [t]);
    expect(() => buildWhere(V, t, off)).toThrow(/deeply/);
    const many = grp('AND', Array.from({ length: LIMITS.maxConditions + 1 }, () => cond('kev_flag', 'is true')));
    expect(() => buildWhere(V, many, off)).toThrow(/Too many conditions/);
  });
});

describe('operators', () => {
  const w = (c: Node) => buildWhere(V, grp('AND', [c]), off);
  it('string ops', () => {
    expect(w(cond('hostname', 'is', 'A')).where).toContain('LOWER(`hostname`) = LOWER(:p0)');
    expect(w(cond('hostname', 'is not', 'A')).where).toContain('(`hostname` IS NULL OR LOWER(`hostname`) <> LOWER(:p0))');
    expect(w(cond('hostname', 'does not contain', 'A')).where).toContain('NOT (LOWER(`hostname`) LIKE LOWER(:p0))');
    expect(w(cond('hostname', 'starts with', 'A_')).params.p0).toBe('A\\_%');
    expect(w(cond('hostname', 'ends with', 'A')).params.p0).toBe('%A');
    expect(w(cond('hostname', 'is empty')).where).toContain("(`hostname` IS NULL OR `hostname` = '')");
    expect(w(cond('hostname', 'is not empty')).where).toContain("`hostname` IS NOT NULL AND `hostname` <> ''");
    expect(w(cond('hostname', 'matches regex', '^NG-.*')).where).toContain('`hostname` RLIKE :p0');
  });
  it('contains escapes LIKE wildcards', () => {
    expect(w(cond('hostname', 'contains', '50%_\\')).params.p0).toBe('%50\\%\\_\\\\%');
  });
  it('enum ops incl. none-of null handling', () => {
    expect(w(cond('severity', 'is none of', ['Low', 'Info'])).where).toContain('(`severity` IS NULL OR `severity` NOT IN (:p0, :p1))');
    expect(w(cond('severity', 'is not', 'Low')).where).toContain('(`severity` IS NULL OR `severity` <> :p0)');
  });
  it('number ops', () => {
    expect(w(cond('epss', '>', 0.5)).where).toContain('`epss` > :p0');
    expect(w(cond('epss', '≥', '0.5')).params.p0).toBe(0.5);
    expect(w(cond('epss', 'between', [0.1, 0.9])).where).toContain('`epss` BETWEEN :p0 AND :p1');
    expect(w(cond('epss', '≠', 1)).where).toContain('<> :p0');
    expect(w(cond('epss', '<', 1)).where).toContain('< :p0');
    expect(w(cond('epss', '≤', 1)).where).toContain('<= :p0');
    expect(w(cond('epss', '=', 1)).where).toContain('= :p0');
    expect(w(cond('epss', 'is empty')).where).toContain('`epss` IS NULL');
    expect(w(cond('epss', 'is not empty')).where).toContain('`epss` IS NOT NULL');
  });
  it('boolean ops', () => {
    expect(w(cond('kev_flag', 'is false')).where).toContain('`kev_flag` = false');
    expect(w(cond('kev_flag', 'is empty')).where).toContain('`kev_flag` IS NULL');
  });
  it('date ops', () => {
    expect(w(cond('first_found', 'on', '2026-01-02')).where).toContain('CAST(`first_found` AS DATE) = CAST(:p0 AS DATE)');
    expect(w(cond('first_found', 'before', '2026-01-02')).where).toContain('< CAST(:p0 AS DATE)');
    expect(w(cond('first_found', 'after', '2026-01-02')).where).toContain('> CAST(:p0 AS DATE)');
    expect(w(cond('first_found', 'between', ['2026-01-01', '2026-02-01'])).where).toContain('BETWEEN CAST(:p0 AS DATE) AND CAST(:p1 AS DATE)');
    expect(w(cond('first_found', 'in the last N days', 30)).where).toContain('`first_found` >= date_sub(current_date(), :p0)');
    expect(w(cond('first_found', 'older than N days', 30)).where).toContain('`first_found` < date_sub(current_date(), :p0)');
    expect(w(cond('first_found', 'is empty')).where).toContain('`first_found` IS NULL');
  });
});

describe('rejections', () => {
  const bad = (c: Node) => () => buildWhere(V, grp('AND', [c]), off);
  it('unknown / malicious fields', () => {
    expect(bad(cond('nope', 'is', 'x'))).toThrow(BuilderError);
    expect(bad(cond('severity`; DROP TABLE x; --', 'is', 'x'))).toThrow(/Unknown field/);
    expect(bad(cond('`severity`', 'is', 'x'))).toThrow(/Unknown field/);
    expect(bad(cond('final_score', 'is', 'x'))).toThrow(/not valid/);
  });
  it('operators not valid for the type', () => {
    expect(bad(cond('kev_flag', 'contains', 'x'))).toThrow(/not valid/);
    expect(bad(cond('severity', 'matches regex', '.*'))).toThrow(/not valid/);
    expect(bad(cond('severity', '1=1; --', 'x'))).toThrow(/not valid/);
  });
  it('values are bound, never inlined', () => {
    const r = buildWhere(V, grp('AND', [cond('hostname', 'is', "'; DROP TABLE gold_assets; --")]), off);
    expect(r.where).not.toMatch(/DROP/);
    expect(Object.values(r.params)).toContain("'; DROP TABLE gold_assets; --");
  });
  it('value limits and shapes', () => {
    expect(bad(cond('hostname', 'is', 'x'.repeat(501)))).toThrow(/too long/);
    expect(bad(cond('severity', 'is one of', Array.from({ length: 501 }, (_, i) => String(i))))).toThrow(/Too many values/);
    expect(bad(cond('severity', 'is one of', []))).toThrow();
    expect(bad(cond('epss', '>', 'abc'))).toThrow(/numeric/);
    expect(bad(cond('first_found', 'on', 'garbage'))).toThrow(/date/);
    expect(bad(cond('first_found', 'in the last N days', -1))).toThrow();
    // only the date part is ever bound
    expect(buildWhere(V, grp('AND', [cond('first_found', 'on', "2026-01-01'); DROP")]), off).params.p0).toBe('2026-01-01');
  });
  it('invalid node types and group ops', () => {
    expect(() => buildWhere(V, { type: 'group', op: 'XOR' as any, not: false, children: [] }, off)).toThrow(/AND or OR/);
    expect(() => buildWhere(V, grp('AND', [{ type: 'weird' } as any]), off)).toThrow();
  });
});

describe('select builders', () => {
  const base = { entity: V, tree: grp('AND', [cond('kev_flag', 'is true')]), options: { latestSnapshotOnly: true, validOnly: true }, page: 2, pageSize: 50 };
  it('buildRun: whitelisted columns, stable ordering, paging params', () => {
    const r = buildRun({ ...base, columns: ['severity', 'hostname'], sort: { field: 'final_score', dir: 'desc' } });
    expect(r.sql).toMatch(/^SELECT `severity`, `hostname` FROM `[\w-]+`\.`[\w-]+`\.`gold_vulnerabilities` WHERE /);
    expect(r.sql).toContain('ORDER BY `final_score` DESC NULLS LAST, `finding_id` ASC, `snapshot_date` ASC LIMIT :p0 OFFSET :p1');
    expect(r.params).toMatchObject({ p0: 50, p1: 100 });
    expect(r.countSql).toMatch(/^SELECT COUNT\(\*\) AS total/);
    expect(r.countParams).toEqual({});
    expect(r.sql).not.toContain('SELECT *');
  });
  it('does not duplicate the tiebreaker when sorting by it', () => {
    const r = buildRun({ ...base, columns: ['severity'], sort: { field: 'finding_id', dir: 'asc' } });
    expect(r.sql.match(/`finding_id` ASC/g)).toHaveLength(1);
  });
  it('rejects unknown columns, sort fields, directions, page sizes and entities', () => {
    expect(() => buildRun({ ...base, columns: ['severity`, (select 1)'] })).toThrow(/Unknown column/);
    expect(() => buildRun({ ...base, columns: ['severity'], sort: { field: 'x; DROP', dir: 'asc' } })).toThrow(/unknown column/);
    expect(() => buildRun({ ...base, columns: ['severity'], sort: { field: 'severity', dir: 'sideways' as any } })).toThrow(/direction/);
    expect(() => buildRun({ ...base, columns: ['severity'], pageSize: 100000 })).toThrow(/pageSize/);
    expect(() => buildRun({ ...base, entity: 'users' as any, columns: [] })).toThrow(/entity/);
  });
  it('falls back to default columns when none are given', () => {
    expect(buildRun({ ...base, columns: [] }).columns.length).toBeGreaterThan(3);
  });
  it('count / export / detail', () => {
    expect(Object.keys(buildCount(base).params)).toEqual([]);
    const e = buildExport({ ...base, columns: ['severity'], sort: null });
    expect(e.sql).not.toContain('LIMIT');
    const d = buildDetail('assets', 'GA-000001', '2026-09-12');
    expect(d.sql).toContain('`gold_asset_id` = :p0');
    expect(d.sql).toContain('LIMIT 1');
    expect(() => buildDetail('assets', '', undefined)).toThrow();
  });
});

describe('global filters → tree', () => {
  it('ANDs filters, ORs values within one', () => {
    const t = filtersToTree({ ...EMPTY_FILTERS, business_unit: ['A', 'B'], region: ['West Africa'], internet_exposed: 'yes' });
    const r = buildWhere(V, t, off);
    expect(r.where).toBe('WHERE ((`business_unit` IN (:p0, :p1) AND `region` = :p2 AND `internet_exposed` = true))');
    expect(buildWhere(V, filtersToTree(EMPTY_FILTERS), off).where).toBe('WHERE TRUE');
  });
});

describe('summary (GROUP BY)', () => {
  const tree = grp('AND', [cond('kev_flag', 'is true')]);
  const opts = { latestSnapshotOnly: true, validOnly: true };
  const sum = (summary: any, extra: any = {}) => buildSummary({ entity: V, tree, options: opts, summary: { limit: 50, ...summary }, ...extra });

  it('one group + count distinct, default sort is the first metric descending', () => {
    const r = sum({ groupBy: [{ field: 'business_unit' }], metrics: [{ fn: 'count_distinct', field: 'gold_asset_id' }] });
    expect(r.sql).toContain("SELECT COALESCE(CAST(`business_unit` AS STRING), '(empty)') AS `group_1`, COUNT(DISTINCT `gold_asset_id`) AS `metric_1` FROM");
    expect(r.sql).toContain('GROUP BY 1 ORDER BY `metric_1` DESC NULLS LAST, `group_1` ASC LIMIT :p0');
    expect(r.params.p0).toBe(50);
    expect(r.labels).toEqual(['Business Unit', 'Assets']);
    expect(r.columns).toEqual(['group_1', 'metric_1']);
  });
  it('two groups, several metrics and every function', () => {
    const r = sum({ groupBy: [{ field: 'business_unit' }, { field: 'severity' }], metrics: [{ fn: 'count' }, { fn: 'sum', field: 'final_score' }, { fn: 'avg', field: 'epss' }, { fn: 'max', field: 'first_found' }] });
    expect(r.sql).toContain('COUNT(*) AS `metric_1`');
    expect(r.sql).toContain('SUM(`final_score`) AS `metric_2`');
    expect(r.sql).toContain('ROUND(AVG(`epss`), 2) AS `metric_3`');
    expect(r.sql).toContain('MAX(`first_found`) AS `metric_4`');
    expect(r.sql).toContain('GROUP BY 1, 2');
    expect(r.labels).toEqual(['Business Unit', 'Severity', 'Records', 'Total Final Score', 'Average EPSS', 'Highest First Found']);
  });
  it('date buckets and explicit sort', () => {
    const r = sum({ groupBy: [{ field: 'first_found', bucket: 'month' }], metrics: [{ fn: 'count' }], sort: { by: 'group_1', dir: 'desc' } });
    expect(r.sql).toContain("date_trunc('MONTH', `first_found`)");
    expect(r.sql).toContain('ORDER BY `group_1` DESC NULLS LAST');
    expect(r.labels[0]).toBe('First Found (by month)');
  });
  it('shares the filter tree, snapshot and validity scope', () => {
    const r = sum({ groupBy: [{ field: 'severity' }], metrics: [{ fn: 'count' }] });
    expect(r.sql).toContain('WHERE `snapshot_date` = (SELECT MAX(`snapshot_date`)');
    expect(r.sql).toContain('`kev_flag` = true');
    expect(r.countSql).toMatch(/^SELECT COUNT\(\*\) AS total FROM \(SELECT 1 FROM .* GROUP BY COALESCE\(CAST\(`severity` AS STRING\), '\(empty\)'\)\) g$/);
    expect(r.countSql).not.toContain('LIMIT');
  });
  it('noLimit drops LIMIT (CSV export)', () => {
    const r = buildSummary({ entity: V, tree, options: opts, summary: { limit: 5, groupBy: [{ field: 'severity' }], metrics: [{ fn: 'count' }] } }, { noLimit: true });
    expect(r.sql).not.toContain('LIMIT');
  });
  it('rejects bad input', () => {
    const bad = (summary: any) => () => sum(summary);
    expect(bad({ groupBy: [{ field: 'nope' }], metrics: [{ fn: 'count' }] })).toThrow(/Unknown field/);
    expect(bad({ groupBy: [{ field: 'severity`; DROP' }], metrics: [{ fn: 'count' }] })).toThrow(BuilderError);
    expect(bad({ groupBy: [], metrics: [{ fn: 'count' }] })).toThrow(/1-2/);
    expect(bad({ groupBy: [{ field: 'severity' }, { field: 'region' }, { field: 'country' }], metrics: [{ fn: 'count' }] })).toThrow(/1-2/);
    expect(bad({ groupBy: [{ field: 'severity' }, { field: 'severity' }], metrics: [{ fn: 'count' }] })).toThrow(/twice/);
    expect(bad({ groupBy: [{ field: 'severity' }], metrics: [] })).toThrow(/1-4/);
    expect(bad({ groupBy: [{ field: 'severity' }], metrics: [{ fn: 'drop' as any }] })).toThrow(/Unknown calculation/);
    expect(bad({ groupBy: [{ field: 'severity' }], metrics: [{ fn: 'sum', field: 'severity' }] })).toThrow(/number field/);
    expect(bad({ groupBy: [{ field: 'severity' }], metrics: [{ fn: 'min', field: 'hostname' }] })).toThrow(/number or date/);
    expect(bad({ groupBy: [{ field: 'severity' }], metrics: [{ fn: 'sum', field: 'x`) --' }] })).toThrow(/Unknown field/);
    expect(bad({ groupBy: [{ field: 'severity', bucket: 'month' }], metrics: [{ fn: 'count' }] })).toThrow(/not a date/);
    expect(bad({ groupBy: [{ field: 'first_found', bucket: "day') ; DROP" as any }], metrics: [{ fn: 'count' }] })).toThrow(/bucket/);
    expect(bad({ groupBy: [{ field: 'severity' }], metrics: [{ fn: 'count' }], sort: { by: 'severity; DROP', dir: 'asc' } })).toThrow(/Cannot sort/);
    expect(bad({ groupBy: [{ field: 'severity' }], metrics: [{ fn: 'count' }], sort: { by: 'metric_1', dir: 'up' as any } })).toThrow(/direction/);
    expect(bad({ groupBy: [{ field: 'severity' }], metrics: [{ fn: 'count' }], limit: 100000 })).toThrow(/limit/);
    expect(() => buildSummary({ entity: 'users' as any, summary: undefined })).toThrow(/entity/);
  });
});

describe('per-connector AND/OR', () => {
  const j = (n: Node, join?: 'AND' | 'OR'): Node => ({ ...n, join } as Node);
  const K = (f: string) => cond(f, 'is true');
  it('A AND B OR C brackets the AND-run (AND binds tighter)', () => {
    const t = grp('AND', [K('kev_flag'), j(K('sla_breached'), 'AND'), j(K('internet_exposed'), 'OR')]);
    expect(buildWhere(V, t, off).where).toBe('WHERE (((`kev_flag` = true AND `sla_breached` = true) OR `internet_exposed` = true))');
  });
  it('A OR B AND C', () => {
    const t = grp('OR', [K('kev_flag'), j(K('sla_breached'), 'OR'), j(K('internet_exposed'), 'AND')]);
    expect(buildWhere(V, t, off).where).toContain('(`kev_flag` = true OR (`sla_breached` = true AND `internet_exposed` = true))');
  });
  it('changing one connector leaves the others alone', () => {
    const t = grp('AND', [K('kev_flag'), K('sla_breached'), j(K('internet_exposed'), 'OR'), K('te_plugin_has_patch')]);
    // items: kev AND sla OR internet AND patch  →  (kev AND sla) OR (internet AND patch)
    expect(buildWhere(V, t, off).where).toContain('(`kev_flag` = true AND `sla_breached` = true) OR (`internet_exposed` = true AND `te_plugin_has_patch` = true)');
  });
  it('uniform connectors still render the simple way; first item join is ignored', () => {
    const t = grp('AND', [j(K('kev_flag'), 'OR'), K('sla_breached')]);
    expect(buildWhere(V, t, off).where).toBe('WHERE ((`kev_flag` = true AND `sla_breached` = true))');
  });
  it('NOT group with mixed connectors and nested groups', () => {
    const t = grp('AND', [K('kev_flag'), j(grp('OR', [K('sla_breached'), j(K('internet_exposed'), 'AND')]), 'OR')], true);
    const w = buildWhere(V, t, off).where;
    expect(w).toBe('WHERE (NOT (`kev_flag` = true OR ((`sla_breached` = true AND `internet_exposed` = true))))');
  });
  it('rejects an invalid join', () => {
    const t = grp('AND', [K('kev_flag'), { ...K('sla_breached'), join: 'XOR' } as any]);
    expect(() => buildWhere(V, t, off)).toThrow(/join must be AND or OR/);
  });
});
