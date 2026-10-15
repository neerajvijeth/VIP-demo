import { afterEach, describe, expect, it } from 'vitest';
import { BANDS, bandSql, fillBands, groupSmall } from '../shared/bands';
import { derivedExtras } from '../shared/filters';
import { EMPTY_FILTERS } from '../shared/types';
import { setLiveColumns } from './fieldCatalog';
import { KNOWN_COLUMNS } from './knownColumns';
import { canonicalSource } from './overviewSource';
import { widgetScope } from './overviewScope';
import { WIDGET_BY_ID, makeCtx } from './overviewWidgets';
import { setSemantics } from '../shared/semantics';

const EXEC = ['execTotals', 'execByClass', 'execServersByOs', 'execServerBands', 'execServerKpis', 'execAppsByCount', 'execAppsByScore', 'execTopServers'];
const sql = (id: string, where = 'WHERE TRUE') => WIDGET_BY_ID.get(id)!.sql(makeCtx('`c`.`s`.`t`', where));
const SERVER_ONLY = ['execServersByOs', 'execServerBands', 'execServerKpis', 'execTopServers'];

afterEach(() => { setSemantics({}); setLiveColumns('assets', KNOWN_COLUMNS.assets); setLiveColumns('vulnerabilities', KNOWN_COLUMNS.vulnerabilities); });

describe('executive sections: base rules on every widget', () => {
  it('all eight widgets exist, on the right table', () => {
    for (const id of EXEC) expect(WIDGET_BY_ID.has(id), id).toBe(true);
    expect(['execTotals', 'execByClass', 'execServersByOs'].every((id) => WIDGET_BY_ID.get(id)!.entity === 'assets')).toBe(true);
    expect(['execServerBands', 'execServerKpis', 'execAppsByCount', 'execAppsByScore', 'execTopServers'].every((id) => WIDGET_BY_ID.get(id)!.entity === 'vulnerabilities')).toBe(true);
  });
  it('Android and iOS devices are excluded everywhere', () => {
    for (const id of EXEC) expect(sql(id), id).toContain("NOT IN ('android', 'ios')");
  });
  it('findings are open only (state not closed, df_status not Fixed)', () => {
    for (const id of ['execServerBands', 'execServerKpis', 'execAppsByCount', 'execAppsByScore', 'execTopServers']) {
      expect(sql(id), id).toContain("NOT IN ('FIXED', 'RESOLVED', 'CLOSED')");
      expect(sql(id), id).toContain("<> 'FIXED'");
    }
  });
  it('the filtered scope (and so the latest snapshot) is the widget\'s own WHERE, never a hardcoded number', () => {
    const w = widgetScope('vulnerabilities', { type: 'group', op: 'AND', not: false, children: [] }, [], { latestSnapshotOnly: true });
    for (const id of EXEC) expect(sql(id, w.where), id).toContain('MAX(`snapshot_date`)');
  });
  it('server scoping: Section 1 OS chart and Sections 2 and 4 only count asset class = Server', () => {
    for (const id of SERVER_ONLY) expect(sql(id), id).toContain("= 'server'");
    expect(sql('execByClass')).not.toContain("= 'server'"); // the class donut shows all classes
    expect(sql('execAppsByCount')).not.toContain("= 'server'"); // applications are across all assets
  });
  it('a unique vulnerability is a distinct (asset, CVE) pair: CVE, else plugin CVE, else plugin id', () => {
    for (const id of ['execServerBands', 'execServerKpis', 'execAppsByCount', 'execTopServers']) {
      expect(sql(id), id).toContain('COALESCE(COALESCE(`cve`, `plugin_cve`, CAST(`plugin_id` AS STRING)), \'unknown\')');
      expect(sql(id), id).toMatch(/GROUP BY `gold_asset_id`, COALESCE\(/);
    }
  });
});

describe('score bands', () => {
  it('thresholds: Critical >= 85, High 70-84, Medium 50-69, Low < 50, NULL in none', () => {
    const s = bandSql('score');
    expect(s).toContain("score >= 85 THEN 'Critical'");
    expect(s).toContain("score >= 70 THEN 'High'");
    expect(s).toContain("score >= 50 THEN 'Medium'");
    expect(s).toContain("score IS NOT NULL THEN 'Low'");
    expect(sql('execServerBands')).toContain("'Critical'");
  });
  it('the four bands always show, in order, with 0 for an empty band', () => {
    expect(fillBands([])).toEqual([{ label: 'Critical', value: 0 }, { label: 'High', value: 0 }, { label: 'Medium', value: 0 }, { label: 'Low', value: 0 }]);
    expect(fillBands([{ label: 'Medium', value: 5 }, { label: 'Critical', value: 2 }]).map((r) => [r.label, r.value])).toEqual([['Critical', 2], ['High', 0], ['Medium', 5], ['Low', 0]]);
    expect(fillBands([{ label: 'Bogus', value: 9 }]).every((r) => r.value === 0)).toBe(true);
    expect(BANDS.map((b) => b.sla)).toEqual(['≤ 72 hours preferred, 7 days max', '7 – 14 days', '30 days', '90 days']);
  });
  it('groups small categories into Other only beyond ten', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ label: `OS ${i}`, value: 12 - i }));
    const g = groupSmall(rows, 10);
    expect(g).toHaveLength(10);
    expect(g.at(-1)).toEqual({ label: 'Other', value: 3 + 2 + 1 }); // the three smallest of the 12 fold in with the 10th
    expect(groupSmall(rows.slice(0, 10), 10)).toHaveLength(10);
    expect(groupSmall(rows.slice(0, 10), 10).some((r) => r.label === 'Other')).toBe(false);
  });
});

describe('the three new global filters respond on every widget', () => {
  it('translate to bridge-aware filters (priority and KEV on findings, OS family on assets)', () => {
    const e = derivedExtras({ ...EMPTY_FILTERS, priority: ['P1', 'P2'], os_family: ['Linux'], kev: 'yes' });
    expect(e.map((x) => [x.entity, x.condition.field, x.condition.operator])).toEqual([['vulnerabilities', 'priority_code', 'is one of'], ['assets', 'os_type', 'is'], ['vulnerabilities', 'kev_flag', 'is true']]);
    expect(derivedExtras({ ...EMPTY_FILTERS, kev: 'no' })[0].condition.not).toBe(true);
    expect(derivedExtras(EMPTY_FILTERS)).toEqual([]);
  });
  it('asset cards bridge a finding-level filter; finding cards bridge an asset-level filter', () => {
    const tree = { type: 'group', op: 'AND', not: false, children: [] } as const;
    const f = derivedExtras({ ...EMPTY_FILTERS, priority: ['P1'], os_family: ['Linux'], kev: 'yes' });
    const onAssets = widgetScope('assets', tree as any, f, { latestSnapshotOnly: true });
    expect(onAssets.where).toMatch(/`gold_asset_id` IN \(SELECT `gold_asset_id` FROM \(SELECT f\.\*/); // priority and KEV
    expect(onAssets.where).toContain('`os_type`');                                                       // OS family direct
    const onFindings = widgetScope('vulnerabilities', tree as any, f, { latestSnapshotOnly: true });
    expect(onFindings.where).toMatch(/`gold_asset_id` IN \(SELECT `gold_asset_id` FROM \(SELECT \* EXCEPT \(_rn\)/); // OS family
    expect(onFindings.where).toContain('`priority_code`');                                              // priority direct
    expect(Object.values(onFindings.params)).toEqual(expect.arrayContaining(['P1', 'Linux']));
  });
  it('findings carry the asset\'s OS (os_type), so the Android / iOS rule works on finding cards too', () => {
    expect(canonicalSource('vulnerabilities')).toContain('a.`os_type`');
  });
});
