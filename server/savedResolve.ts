import type { Entity } from '../shared/types';
import { summaryLabels } from '../shared/summary';
import { BuilderError, buildExport, buildSummary } from './sqlBuilder';
import { getField } from './fieldCatalog';
import { validateCustomSql } from './customSql';

/** What a saved query needs to be run: parameterised SQL (builder queries regenerate it from the typed spec every time). */
export interface BuilderPayload {
  tree: any;
  columns: string[] | null;
  sort: { field: string; dir: 'asc' | 'desc' } | null;
  options: { latestSnapshotOnly: boolean; validOnly?: boolean };
  mode: 'rows' | 'summary';
  summary?: any;
}
export interface Resolvable { kind?: 'sql' | 'builder'; sql?: string; entity?: Entity; payload?: BuilderPayload }
export interface Resolved { sql: string; params: Record<string, string | number | boolean> }

const q = (c: string) => '`' + c.replace(/`/g, '``') + '`';

export function cleanPayload(p: any): BuilderPayload {
  if (!p || typeof p !== 'object' || p.tree?.type !== 'group') throw new BuilderError('Invalid query: missing filter tree');
  if (JSON.stringify(p).length > 200_000) throw new BuilderError('Query is too large to save');
  const opts = p.options ?? {};
  return {
    tree: p.tree,
    columns: Array.isArray(p.columns) ? p.columns.filter((c: unknown): c is string => typeof c === 'string').slice(0, 250) : null,
    sort: p.sort && typeof p.sort.field === 'string' ? { field: p.sort.field, dir: p.sort.dir === 'asc' ? 'asc' : 'desc' } : null,
    options: { latestSnapshotOnly: opts.latestSnapshotOnly !== false },
    mode: p.mode === 'summary' ? 'summary' : 'rows',
    summary: p.mode === 'summary' ? p.summary : undefined,
  };
}

export function resolve(x: Resolvable): Resolved {
  if (x.kind !== 'builder') return { sql: validateCustomSql(x.sql), params: {} };
  if (x.entity !== 'assets' && x.entity !== 'vulnerabilities') throw new BuilderError('entity must be assets or vulnerabilities');
  const p = cleanPayload(x.payload);
  if (p.mode === 'summary') {
    const b = buildSummary({ entity: x.entity, tree: p.tree, options: p.options, summary: p.summary }, { noLimit: true });
    // give the columns their human labels so charts offer "Business Unit" rather than group_1
    const labels = summaryLabels(p.summary, (k: string) => getField(x.entity!, k)?.label ?? k);
    const used = new Set<string>();
    const sel = b.columns.map((c, i) => { let l = labels[i] || c; while (used.has(l)) l += ' '; used.add(l); return `${q(c)} AS ${q(l)}`; });
    return { sql: `SELECT ${sel.join(', ')} FROM (${b.sql}\n) s`, params: b.params };
  }
  const b = buildExport({ entity: x.entity, tree: p.tree, columns: p.columns ?? [], sort: p.sort, options: p.options });
  return { sql: b.sql, params: b.params };
}

/** Bound values inlined as escaped literals: used for DESCRIBE and for "show SQL" only, never for execution. */
export function inlineParams(sql: string, params: Record<string, string | number | boolean>): string {
  return sql.replace(/:p(\d+)\b/g, (m, n) => {
    const v = params['p' + n];
    if (v === undefined) return m;
    return typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(v);
  });
}
