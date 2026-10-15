import type { Condition, Entity, Group, Node, QueryOptions, RunRequest, SortSpec, SummarySpec } from '../shared/types';
import { SUMMARY_LIMITS } from '../shared/types';
import { summaryColumns, summaryLabels } from '../shared/summary';
import { OPERATORS } from '../shared/types';
import { detailKey, tiebreakers, defaultColumns, getField, isSelectableColumn } from './fieldCatalog';
import { L } from '../shared/semantics';
import { entityTable } from './config';

export class BuilderError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
  }
}

export const LIMITS = { maxDepth: 6, maxConditions: 100, maxIn: 500, maxString: 500, maxColumns: 250, maxPageSize: 1000 };

export const quoteIdent = (name: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new BuilderError(`Invalid identifier: ${String(name).slice(0, 40)}`);
  return '`' + name + '`';
};

export class ParamBag {
  private n = 0;
  readonly params: Record<string, string | number | boolean> = {};
  add(v: string | number | boolean): string {
    const k = `p${this.n++}`;
    this.params[k] = v;
    return ':' + k;
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' && typeof v !== 'number') throw new BuilderError(`${what} requires a text value`);
  const s = String(v);
  if (s.length === 0) throw new BuilderError(`${what} requires a non-empty value`);
  if (s.length > LIMITS.maxString) throw new BuilderError(`Value too long (max ${LIMITS.maxString} characters)`);
  return s;
}
function num(v: unknown, what: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new BuilderError(`${what} requires a numeric value`);
  return n;
}
function dateStr(v: unknown, what: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) throw new BuilderError(`${what} requires a date (YYYY-MM-DD)`);
  const d = v.slice(0, 10);
  if (Number.isNaN(Date.parse(d))) throw new BuilderError(`${what} requires a valid date`);
  return d;
}
function list<T>(v: unknown, what: string, conv: (x: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length === 0) throw new BuilderError(`${what} requires at least one value`);
  if (v.length > LIMITS.maxIn) throw new BuilderError(`Too many values (max ${LIMITS.maxIn})`);
  return v.map(conv);
}
function pair<T>(v: unknown, what: string, conv: (x: unknown) => T): [T, T] {
  if (!Array.isArray(v) || v.length !== 2) throw new BuilderError(`${what} requires two values`);
  return [conv(v[0]), conv(v[1])];
}

function conditionSql(entity: Entity, c: Condition, bag: ParamBag): string {
  const f = getField(entity, c.field);
  if (!f) throw new BuilderError(`Unknown field: ${String(c.field).slice(0, 60)}`);
  const ops = OPERATORS[f.type];
  if (typeof c.operator !== 'string' || !ops.includes(c.operator)) {
    throw new BuilderError(`Operator "${String(c.operator).slice(0, 40)}" is not valid for ${f.type} field ${f.key}`);
  }
  const col = quoteIdent(f.key);
  const op = c.operator;
  const v = c.value;
  const what = `${f.key} ${op}`;
  let sql: string;

  if (f.type === 'string' || f.type === 'enum') {
    const ci = f.type === 'string'; // free-text strings compare case-insensitively
    const lhs = ci ? `LOWER(${col})` : col;
    const rhs = (p: string) => (ci ? `LOWER(${p})` : p);
    switch (op) {
      case 'is': sql = `${lhs} = ${rhs(bag.add(str(v, what)))}`; break;
      case 'is not': sql = `(${col} IS NULL OR ${lhs} <> ${rhs(bag.add(str(v, what)))})`; break;
      case 'contains': sql = `LOWER(${col}) LIKE LOWER(${bag.add('%' + escapeLike(str(v, what)) + '%')})`; break;
      case 'does not contain': sql = `(${col} IS NULL OR NOT (LOWER(${col}) LIKE LOWER(${bag.add('%' + escapeLike(str(v, what)) + '%')})))`; break;
      case 'starts with': sql = `LOWER(${col}) LIKE LOWER(${bag.add(escapeLike(str(v, what)) + '%')})`; break;
      case 'ends with': sql = `LOWER(${col}) LIKE LOWER(${bag.add('%' + escapeLike(str(v, what)))})`; break;
      case 'is one of': sql = `${lhs} IN (${list(v, what, (x) => str(x, what)).map((x) => rhs(bag.add(x))).join(', ')})`; break;
      case 'is none of': sql = `(${col} IS NULL OR ${lhs} NOT IN (${list(v, what, (x) => str(x, what)).map((x) => rhs(bag.add(x))).join(', ')}))`; break;
      case 'is empty': sql = `(${col} IS NULL OR ${col} = '')`; break;
      case 'is not empty': sql = `(${col} IS NOT NULL AND ${col} <> '')`; break;
      case 'matches regex': sql = `${col} RLIKE ${bag.add(str(v, what))}`; break;
      default: throw new BuilderError(`Unsupported operator ${op}`);
    }
  } else if (f.type === 'number') {
    switch (op) {
      case '=': sql = `${col} = ${bag.add(num(v, what))}`; break;
      case '≠': sql = `(${col} IS NULL OR ${col} <> ${bag.add(num(v, what))})`; break;
      case '>': sql = `${col} > ${bag.add(num(v, what))}`; break;
      case '≥': sql = `${col} >= ${bag.add(num(v, what))}`; break;
      case '<': sql = `${col} < ${bag.add(num(v, what))}`; break;
      case '≤': sql = `${col} <= ${bag.add(num(v, what))}`; break;
      case 'between': { const [a, b] = pair(v, what, (x) => num(x, what)); sql = `${col} BETWEEN ${bag.add(a)} AND ${bag.add(b)}`; break; }
      case 'is empty': sql = `${col} IS NULL`; break;
      case 'is not empty': sql = `${col} IS NOT NULL`; break;
      default: throw new BuilderError(`Unsupported operator ${op}`);
    }
  } else if (f.type === 'boolean') {
    switch (op) {
      case 'is true': sql = `${col} = true`; break;
      case 'is false': sql = `${col} = false`; break;
      case 'is empty': sql = `${col} IS NULL`; break;
      default: throw new BuilderError(`Unsupported operator ${op}`);
    }
  } else {
    // date
    const d = `CAST(${col} AS DATE)`;
    const days = (x: unknown) => {
      const n = num(x, what);
      if (!Number.isInteger(n) || n < 0 || n > 36500) throw new BuilderError('N must be a whole number of days between 0 and 36500');
      return n;
    };
    switch (op) {
      case 'on': sql = `${d} = CAST(${bag.add(dateStr(v, what))} AS DATE)`; break;
      case 'before': sql = `${d} < CAST(${bag.add(dateStr(v, what))} AS DATE)`; break;
      case 'after': sql = `${d} > CAST(${bag.add(dateStr(v, what))} AS DATE)`; break;
      case 'between': { const [a, b] = pair(v, what, (x) => dateStr(x, what)); sql = `${d} BETWEEN CAST(${bag.add(a)} AS DATE) AND CAST(${bag.add(b)} AS DATE)`; break; }
      case 'in the last N days': sql = `(${col} >= date_sub(current_date(), ${bag.add(days(v))}) AND ${d} <= current_date())`; break;
      case 'older than N days': sql = `${col} < date_sub(current_date(), ${bag.add(days(v))})`; break;
      case 'is empty': sql = `${col} IS NULL`; break;
      default: throw new BuilderError(`Unsupported operator ${op}`);
    }
  }
  return c.not === true ? `NOT (COALESCE(${sql}, FALSE))` : sql;
}

interface Ctx { entity: Entity; bag: ParamBag; conditions: number }

function nodeSql(node: Node, ctx: Ctx, depth: number): string {
  if (!node || typeof node !== 'object') throw new BuilderError('Invalid query node');
  if (node.type === 'condition') {
    if (++ctx.conditions > LIMITS.maxConditions) throw new BuilderError(`Too many conditions (max ${LIMITS.maxConditions})`);
    return conditionSql(ctx.entity, node, ctx.bag);
  }
  if (node.type !== 'group') throw new BuilderError('Invalid query node type');
  if (depth > LIMITS.maxDepth) throw new BuilderError(`Query nested too deeply (max depth ${LIMITS.maxDepth})`);
  if (node.op !== 'AND' && node.op !== 'OR') throw new BuilderError('Group operator must be AND or OR');
  if (!Array.isArray(node.children)) throw new BuilderError('Group children must be an array');
  const items = node.children
    .map((c) => {
      if (c && (c as Node).join !== undefined && (c as Node).join !== 'AND' && (c as Node).join !== 'OR') throw new BuilderError('join must be AND or OR');
      return { sql: nodeSql(c, ctx, depth + 1), join: (c as Node).join ?? node.op };
    })
    .filter((x) => x.sql);
  if (!items.length) return '';
  let joined: string;
  if (items.slice(1).every((x) => x.join === node.op)) {
    joined = items.map((x) => x.sql).join(` ${node.op} `);
  } else {
    // Mixed connectors: AND binds tighter than OR (SQL precedence); emit explicit brackets so it is unambiguous.
    const runs: string[][] = [[items[0].sql]];
    for (const it of items.slice(1)) (it.join === 'OR' ? runs.push([it.sql]) : runs[runs.length - 1].push(it.sql));
    joined = runs.map((r) => (r.length > 1 ? `(${r.join(' AND ')})` : r[0])).join(' OR ');
  }
  return node.not === true ? `NOT (${joined})` : `(${joined})`;
}

/** Tree → SQL boolean expression ('' for an empty tree). */
export function treeToSql(entity: Entity, tree: Group | undefined | null, bag: ParamBag): string {
  if (!tree) return '';
  if (tree.type !== 'group') throw new BuilderError('Query root must be a group');
  return nodeSql(tree, { entity, bag, conditions: 0 }, 1);
}

/** Full `WHERE ...` clause: snapshot scope AND (user tree). (The "valid records only" switch was removed: is_valid is no longer applied.) Always returns a valid clause. */
export function buildWhere(entity: Entity, tree: Group | undefined | null, options: Partial<QueryOptions> | undefined, bag = new ParamBag()) {
  const parts: string[] = [];
  // Scope clauses apply only when the column exists on this table (discovered schema), so other data shapes still work.
  const snap = L('snapshot_date');
  if (options?.latestSnapshotOnly && isSelectableColumn(entity, snap)) parts.push(`${quoteIdent(snap)} = (SELECT MAX(${quoteIdent(snap)}) FROM ${entityTable(entity)})`);
  const user = treeToSql(entity, tree, bag);
  if (user) parts.push(`(${user})`);
  return { where: parts.length ? `WHERE ${parts.join(' AND ')}` : 'WHERE TRUE', params: bag.params, bag };
}

function validateColumns(entity: Entity, columns: unknown): string[] {
  const cols = Array.isArray(columns) && columns.length ? columns : defaultColumns(entity);
  if (cols.length > LIMITS.maxColumns) throw new BuilderError(`Too many columns (max ${LIMITS.maxColumns})`);
  const seen = new Set<string>();
  for (const c of cols) {
    if (typeof c !== 'string' || !isSelectableColumn(entity, c)) throw new BuilderError(`Unknown column: ${String(c).slice(0, 60)}`);
    seen.add(c);
  }
  return [...seen];
}

function orderBy(entity: Entity, sort?: SortSpec | null): string {
  const parts: string[] = [];
  if (sort && sort.field) {
    if (!isSelectableColumn(entity, sort.field)) throw new BuilderError(`Cannot sort by unknown column: ${String(sort.field).slice(0, 60)}`);
    if (sort.dir !== 'asc' && sort.dir !== 'desc') throw new BuilderError('Sort direction must be asc or desc');
    parts.push(`${quoteIdent(sort.field)} ${sort.dir.toUpperCase()} NULLS LAST`);
  }
  for (const t of tiebreakers(entity)) if (!sort || sort.field !== t) parts.push(`${quoteIdent(t)} ASC`);
  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
}

function entityOf(e: unknown): Entity {
  if (e !== 'assets' && e !== 'vulnerabilities') throw new BuilderError('entity must be "assets" or "vulnerabilities"');
  return e;
}

export function buildRun(req: Pick<RunRequest, 'entity' | 'tree' | 'columns' | 'sort' | 'page' | 'pageSize' | 'options'>) {
  const entity = entityOf(req.entity);
  const columns = validateColumns(entity, req.columns);
  const pageSize = Number(req.pageSize ?? 50);
  const page = Number(req.page ?? 0);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > LIMITS.maxPageSize) throw new BuilderError(`pageSize must be 1-${LIMITS.maxPageSize}`);
  if (!Number.isInteger(page) || page < 0 || page > 1_000_000) throw new BuilderError('page must be a non-negative integer');
  const { where, params, bag } = buildWhere(entity, req.tree, req.options);
  const select = columns.map(quoteIdent).join(', ');
  const limitP = bag.add(pageSize);
  const offsetP = bag.add(page * pageSize);
  const table = entityTable(entity);
  return {
    entity,
    columns,
    sql: `SELECT ${select} FROM ${table} ${where} ${orderBy(entity, req.sort)} LIMIT ${limitP} OFFSET ${offsetP}`,
    params: { ...params },
    countSql: `SELECT COUNT(*) AS total FROM ${table} ${where}`,
    countParams: Object.fromEntries(Object.entries(params).filter(([k]) => k !== limitP.slice(1) && k !== offsetP.slice(1))),
  };
}

export function buildCount(req: Pick<RunRequest, 'entity' | 'tree' | 'options'>) {
  const entity = entityOf(req.entity);
  const { where, params } = buildWhere(entity, req.tree, req.options);
  return { entity, sql: `SELECT COUNT(*) AS total FROM ${entityTable(entity)} ${where}`, params };
}

export function buildExport(req: Pick<RunRequest, 'entity' | 'tree' | 'columns' | 'sort' | 'options'>) {
  const entity = entityOf(req.entity);
  const columns = validateColumns(entity, req.columns);
  const { where, params } = buildWhere(entity, req.tree, req.options);
  const table = entityTable(entity);
  return {
    entity,
    columns,
    sql: `SELECT ${columns.map(quoteIdent).join(', ')} FROM ${table} ${where} ${orderBy(entity, req.sort)}`,
    countSql: `SELECT COUNT(*) AS total FROM ${table} ${where}`,
    params,
  };
}

/** Single-row lookup for the detail drawer (the only place SELECT * is allowed). */
export function buildDetail(entityIn: unknown, key: unknown, snapshotDate?: unknown) {
  const entity = entityOf(entityIn);
  if (typeof key !== 'string' || !key || key.length > LIMITS.maxString) throw new BuilderError('Invalid key');
  const bag = new ParamBag();
  let where = `${quoteIdent(detailKey(entity))} = ${bag.add(key)}`;
  const snap = L('snapshot_date');
  const hasSnap = isSelectableColumn(entity, snap);
  if (hasSnap && typeof snapshotDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(snapshotDate)) {
    where += ` AND CAST(${quoteIdent(snap)} AS STRING) LIKE ${bag.add(snapshotDate.slice(0, 10) + '%')}`;
  }
  return { entity, sql: `SELECT * FROM ${entityTable(entity)} WHERE ${where}${hasSnap ? ` ORDER BY ${quoteIdent(snap)} DESC` : ''} LIMIT 1`, params: bag.params };
}


// ---------- Summaries (GROUP BY) ----------
const BUCKETS = new Set(['day', 'week', 'month']);

/**
 * Aggregate query: `SELECT <groups>, <metrics> FROM t WHERE … GROUP BY <groups> ORDER BY … LIMIT n`.
 * Only whitelisted fields, functions and date buckets are accepted; aliases are generated here, never supplied.
 */
export function buildSummary(
  req: { entity: unknown; tree?: Group | null; options?: Partial<QueryOptions>; summary?: SummarySpec },
  opts: { noLimit?: boolean } = {},
) {
  const entity = entityOf(req.entity);
  const sp = req.summary;
  if (!sp || !Array.isArray(sp.groupBy) || !Array.isArray(sp.metrics)) throw new BuilderError('summary is required');
  if (sp.groupBy.length < 1 || sp.groupBy.length > SUMMARY_LIMITS.maxGroups) throw new BuilderError(`Choose 1-${SUMMARY_LIMITS.maxGroups} fields to group by`);
  if (sp.metrics.length < 1 || sp.metrics.length > SUMMARY_LIMITS.maxMetrics) throw new BuilderError(`Choose 1-${SUMMARY_LIMITS.maxMetrics} values to show`);

  const seen = new Set<string>();
  const groupExprs = sp.groupBy.map((g) => {
    const f = typeof g?.field === 'string' ? getField(entity, g.field) : undefined;
    if (!f) throw new BuilderError(`Unknown field to group by: ${String(g?.field).slice(0, 60)}`);
    if (seen.has(f.key)) throw new BuilderError(`${f.label} is selected twice`);
    seen.add(f.key);
    const col = quoteIdent(f.key);
    if (f.type === 'date') {
      const bucket = g.bucket ?? 'day';
      if (!BUCKETS.has(bucket)) throw new BuilderError('bucket must be day, week or month');
      return `COALESCE(CAST(CAST(date_trunc('${bucket.toUpperCase()}', ${col}) AS DATE) AS STRING), '(empty)')`;
    }
    if (g.bucket) throw new BuilderError(`${f.label} is not a date field`);
    return `COALESCE(CAST(${col} AS STRING), '(empty)')`;
  });

  const metricExprs = sp.metrics.map((m) => {
    const fn = m?.fn;
    if (fn === 'count') return 'COUNT(*)';
    if (!['count_distinct', 'sum', 'avg', 'min', 'max'].includes(fn as string)) throw new BuilderError(`Unknown calculation: ${String(fn).slice(0, 30)}`);
    const f = typeof m.field === 'string' ? getField(entity, m.field) : undefined;
    if (!f) throw new BuilderError(`Unknown field for ${fn}: ${String(m.field).slice(0, 60)}`);
    const col = quoteIdent(f.key);
    if (fn === 'count_distinct') return `COUNT(DISTINCT ${col})`;
    if ((fn === 'sum' || fn === 'avg') && f.type !== 'number') throw new BuilderError(`${fn} needs a number field, but ${f.label} is ${f.type}`);
    if ((fn === 'min' || fn === 'max') && f.type !== 'number' && f.type !== 'date') throw new BuilderError(`${fn} needs a number or date field, but ${f.label} is ${f.type}`);
    return fn === 'avg' ? `ROUND(AVG(${col}), 2)` : `${fn.toUpperCase()}(${col})`;
  });

  const columns = summaryColumns(sp);
  const labels = summaryLabels(sp, (k) => getField(entity, k)?.label ?? k);
  const select = [...groupExprs.map((e, i) => `${e} AS \`group_${i + 1}\``), ...metricExprs.map((e, i) => `${e} AS \`metric_${i + 1}\``)].join(', ');
  const groupBy = groupExprs.map((_, i) => String(i + 1)).join(', ');

  const sortBy = sp.sort?.by ?? 'metric_1';
  if (!columns.includes(sortBy)) throw new BuilderError('Cannot sort by that column');
  const dir = sp.sort?.dir ?? (sortBy.startsWith('metric') ? 'desc' : 'asc');
  if (dir !== 'asc' && dir !== 'desc') throw new BuilderError('Sort direction must be asc or desc');
  const order = [`\`${sortBy}\` ${dir.toUpperCase()} NULLS LAST`, ...columns.filter((c) => c.startsWith('group') && c !== sortBy).map((c) => `\`${c}\` ASC`)].join(', ');

  const limit = Number(sp.limit ?? SUMMARY_LIMITS.defaultRows);
  if (!Number.isInteger(limit) || limit < 1 || limit > SUMMARY_LIMITS.maxRows) throw new BuilderError(`limit must be 1-${SUMMARY_LIMITS.maxRows}`);

  const { where, params, bag } = buildWhere(entity, req.tree, req.options);
  const table = entityTable(entity);
  const base = `SELECT ${select} FROM ${table} ${where} GROUP BY ${groupBy} ORDER BY ${order}`;
  const limitP = opts.noLimit ? null : bag.add(limit);
  const countParams = { ...params };
  if (limitP) delete countParams[limitP.slice(1)];
  return {
    entity,
    columns,
    labels,
    sql: limitP ? `${base} LIMIT ${limitP}` : base,
    params: { ...params },
    countSql: `SELECT COUNT(*) AS total FROM (SELECT 1 FROM ${table} ${where} GROUP BY ${groupExprs.join(', ')}) g`,
    countParams,
  };
}
