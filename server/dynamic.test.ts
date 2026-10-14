import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { DEFAULT_SEMANTICS, L, logicalOf, setSemantics } from '../shared/semantics';
import { loadSemantics } from './semantics';
import { WIDGETS, makeCtx, requiredColumns } from './overviewWidgets';
import { buildWhere, buildDetail, buildRun } from './sqlBuilder';
import { applyLiveSchema, fieldTypeFor, getField, isSelectableColumn, scopeAvailability, setLiveColumns } from './fieldCatalog';
import { cached, cacheStats, clearCache } from './cache';
import { KNOWN_COLUMNS } from './knownColumns';

const grp = (children: any[] = []) => ({ type: 'group', op: 'AND', not: false, children }) as any;
const reset = () => setSemantics({});

describe('semantics loading', () => {
  afterEach(reset);
  it('defaults are the current gold tables', () => {
    const s = loadSemantics({} as any);
    expect(s.tables).toEqual(DEFAULT_SEMANTICS.tables);
    expect(L('kev_flag')).toBe('kev_flag');
  });
  it('reads table, column and value overrides from env', () => {
    const s = loadSemantics({ TABLE_ASSETS: 'dim_assets', COLUMN_MAP: '{"kev_flag":"is_kev"}', CLOSED_STATES: 'FIXED, Closed', HIGH_SEVERITIES: 'Sev1,Sev2' } as any);
    expect(s.tables.assets).toBe('dim_assets');
    expect(L('kev_flag')).toBe('is_kev');
    expect(logicalOf('is_kev')).toBe('kev_flag');
    expect(s.values.closedStates).toEqual(['FIXED', 'Closed']);
    expect(s.values.highSeverities).toEqual(['Sev1', 'Sev2']);
  });
  it('rejects unsafe identifiers and bad JSON', () => {
    expect(() => loadSemantics({ TABLE_ASSETS: 'a`; DROP' } as any)).toThrow(/Invalid table/);
    expect(() => loadSemantics({ COLUMN_MAP: '{"a":"b`c"}' } as any)).toThrow(/Invalid COLUMN_MAP/);
    expect(() => loadSemantics({ COLUMN_MAP: 'not json' } as any)).toThrow(/COLUMN_MAP must be JSON/);
  });
});

describe('widgets follow the mapping and values', () => {
  afterEach(reset);
  const sql = (id: string, where = 'WHERE TRUE') => WIDGETS.find((w) => w.id === id)!.sql(makeCtx('`c`.`s`.`t`', where));
  it('default SQL is unchanged', () => {
    expect(sql('kpiKev')).toContain('`kev_flag` = true');
    expect(sql('kpiOpenVulns')).toContain("NOT IN ('FIXED')");
    expect(sql('kpiCritHigh')).toContain("`severity` IN ('Critical', 'High')");
  });
  it('uses mapped columns and configured values', () => {
    setSemantics({ columns: { kev_flag: 'is_kev', finding_id: 'fid' }, values: { closedStates: ['Closed', "Won't fix"], highSeverities: ['Sev1'] } });
    expect(sql('kpiKev')).toContain('`is_kev` = true');
    expect(sql('kpiKev')).toContain('COUNT(DISTINCT `fid`)');
    expect(sql('kpiOpenVulns')).toContain("NOT IN ('CLOSED', 'WON''T FIX')");
    expect(sql('kpiCritHigh')).toContain("`severity` IN ('Sev1')");
  });
  it('reports the physical columns each widget needs', () => {
    expect(requiredColumns(WIDGETS.find((w) => w.id === 'kpiKev')!).sort()).toEqual(['finding_id', 'kev_flag', 'severity'.replace('severity', 'te_state')].sort());
    setSemantics({ columns: { kev_flag: 'is_kev' } });
    expect(requiredColumns(WIDGETS.find((w) => w.id === 'kpiKev')!)).toContain('is_kev');
  });
});

describe('scope columns and keys follow the schema', () => {
  afterEach(() => { reset(); setLiveColumns('vulnerabilities', KNOWN_COLUMNS.vulnerabilities); });
  const off = { latestSnapshotOnly: true, validOnly: true };
  it('skips snapshot / validity clauses when the column does not exist', () => {
    setLiveColumns('vulnerabilities', KNOWN_COLUMNS.vulnerabilities.filter((c) => c !== 'snapshot_date' && c !== 'is_valid'));
    const w = buildWhere('vulnerabilities', grp(), off).where;
    expect(w).toBe('WHERE TRUE');
    expect(scopeAvailability('vulnerabilities')).toEqual({ snapshot: false, valid: false });
  });
  it('uses a renamed snapshot column', () => {
    setSemantics({ columns: { snapshot_date: 'load_date' } });
    setLiveColumns('vulnerabilities', [...KNOWN_COLUMNS.vulnerabilities, 'load_date']);
    expect(buildWhere('vulnerabilities', grp(), off).where).toContain('`load_date` = (SELECT MAX(`load_date`)');
    expect(buildDetail('vulnerabilities', 'F-1', '2026-01-01').sql).toContain('`load_date`');
  });
  it('orders by existing tiebreakers only', () => {
    setLiveColumns('vulnerabilities', KNOWN_COLUMNS.vulnerabilities.filter((c) => c !== 'snapshot_date'));
    const r = buildRun({ entity: 'vulnerabilities', tree: grp(), columns: ['severity'], page: 0, pageSize: 10, options: off, sort: null });
    expect(r.sql).toContain('ORDER BY `finding_id` ASC LIMIT');
    expect(r.sql).not.toContain('snapshot_date');
  });
});

describe('types come from the warehouse', () => {
  afterEach(() => { setLiveColumns('assets', KNOWN_COLUMNS.assets); });
  it('maps data types to field types', () => {
    expect(fieldTypeFor('BIGINT')).toBe('number');
    expect(fieldTypeFor('decimal(10,2)')).toBe('number');
    expect(fieldTypeFor('timestamp_ntz')).toBe('date');
    expect(fieldTypeFor('boolean')).toBe('boolean');
    expect(fieldTypeFor('array<string>')).toBeNull();
    expect(fieldTypeFor('struct<a:int>')).toBeNull();
  });
  it('overrides curated types, keeps enum hints for strings, adds unknown columns, drops missing ones', () => {
    const cols = [
      { name: 'hostname', dataType: 'string' },
      { name: 'criticality', dataType: 'string' }, // curated enum stays enum
      { name: 'os_major_version', dataType: 'string' }, // curated number → real type string
      { name: 'internet_exposed', dataType: 'string' }, // curated boolean → string
      { name: 'brand_new_metric', dataType: 'double' },
      { name: 'tags_array', dataType: 'array<string>' },
    ];
    const r = applyLiveSchema('assets', cols);
    expect(getField('assets', 'criticality')?.type).toBe('enum');
    expect(getField('assets', 'os_major_version')?.type).toBe('string');
    expect(getField('assets', 'internet_exposed')?.type).toBe('string');
    expect(getField('assets', 'brand_new_metric')).toMatchObject({ type: 'number', group: 'Other columns' });
    expect(getField('assets', 'tags_array')).toBeUndefined(); // not filterable…
    expect(isSelectableColumn('assets', 'tags_array')).toBe(true); // …but can still be shown
    expect(getField('assets', 'region')).toBeUndefined(); // missing from the live schema → dropped
    expect(r.retyped.length).toBeGreaterThan(0);
    // the retyped field now offers text operators, so generated SQL matches the real type
    const w = buildWhere('assets', grp([{ type: 'condition', field: 'os_major_version', operator: 'contains', value: '20', not: false }]), {}).where;
    expect(w).toContain('LOWER(`os_major_version`) LIKE');
  });
});

describe('result cache', () => {
  beforeEach(() => { clearCache(); cacheStats.hits = cacheStats.misses = cacheStats.deduped = 0; });
  it('serves repeats from cache and runs once', async () => {
    let n = 0;
    const run = async () => ++n;
    expect(await cached('k', run, { ttlMs: 1000 })).toBe(1);
    expect(await cached('k', run, { ttlMs: 1000 })).toBe(1);
    expect(n).toBe(1);
    expect(cacheStats.hits).toBe(1);
  });
  it('de-duplicates concurrent identical calls', async () => {
    let n = 0;
    const run = () => new Promise<number>((ok) => setTimeout(() => ok(++n), 20));
    const [a, b, c] = await Promise.all([cached('d', run, { ttlMs: 1000 }), cached('d', run, { ttlMs: 1000 }), cached('d', run, { ttlMs: 1000 })]);
    expect([a, b, c]).toEqual([1, 1, 1]);
    expect(n).toBe(1);
    expect(cacheStats.deduped).toBe(2);
  });
  it('fresh bypasses the read but refreshes the entry; ttl 0 disables caching', async () => {
    let n = 0;
    const run = async () => ++n;
    await cached('f', run, { ttlMs: 1000 });
    expect(await cached('f', run, { ttlMs: 1000, fresh: true })).toBe(2);
    expect(await cached('f', run, { ttlMs: 1000 })).toBe(2);
    expect(await cached('z', run, { ttlMs: 0 })).toBe(3);
    expect(await cached('z', run, { ttlMs: 0 })).toBe(4);
  });
  it('failed calls are not cached', async () => {
    let n = 0;
    const run = async () => { if (++n === 1) throw new Error('boom'); return n; };
    await expect(cached('e', run, { ttlMs: 1000 })).rejects.toThrow('boom');
    expect(await cached('e', run, { ttlMs: 1000 })).toBe(2);
  });
});
