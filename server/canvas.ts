import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BuilderError } from './sqlBuilder';
import { HttpError, getVersion } from './savedQueries';
import { query } from './db';
import { cached, scopeOf } from './cache';
import { inlineParams, resolve, type Resolved } from './savedResolve';

/**
 * Canvas = named dashboards of tiles. A tile = one saved query (latest or a pinned version) + one chart configuration.
 * Charts are computed by the warehouse: the saved SQL is wrapped as a sub-select and grouped by column names that are validated
 * against the query's real output columns, so nothing the client sends reaches the SQL text except those validated names.
 */
export type ChartType = 'bar' | 'hbar' | 'stacked' | 'line' | 'area' | 'donut' | 'table' | 'kpi';
export type Agg = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
export interface Chart {
  type: ChartType;
  dimension?: string;
  split?: string;
  measure: { agg: Agg; column?: string };
  top_n?: number | null;
  other?: boolean;
  sort?: 'value_desc' | 'value_asc' | 'label_asc' | 'label_desc';
}
export interface Tile { id: string; query_id: string; query_version: 'latest' | number; title: string; chart: Chart; w: number; h: number }
export interface Canvas { id: string; name: string; owner: string; visibility: 'private' | 'team'; tiles: Tile[]; created_at: string; updated_at: string }

// ---------------- storage ----------------
const file = path.resolve(process.env.VIP_DATA_DIR || '.vip-data', 'canvases.json');
interface Doc { canvases: Record<string, Canvas> }
let doc: Doc | null = null;
let chain: Promise<unknown> = Promise.resolve();
const read = (): Doc => (doc ??= (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Doc; } catch { return { canvases: {} }; } })());
function write(mut: (d: Doc) => void) {
  const run = async () => { const d = read(); mut(d); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(file + '.tmp', file); };
  const p = chain.then(run, run); chain = p.catch(() => undefined); return p;
}
const canRead = (c: Canvas, u: string) => c.owner === u || c.visibility === 'team';
const text = (v: unknown, max: number, what: string, required = false) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s && required) throw new BuilderError(`${what} is required`); if (s.length > max) throw new BuilderError(`${what} is too long`); return s; };

// ---------------- validation of a tile / chart (shape only; columns are checked against the query at run time) ----------------
const TYPES: ChartType[] = ['bar', 'hbar', 'stacked', 'line', 'area', 'donut', 'table', 'kpi'];
const AGGS: Agg[] = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'];
const SORTS = ['value_desc', 'value_asc', 'label_asc', 'label_desc'];
export function cleanChart(c: any): Chart {
  if (!c || !TYPES.includes(c.type)) throw new BuilderError('Unknown chart type');
  const m = c.measure ?? { agg: 'count' };
  if (!AGGS.includes(m.agg)) throw new BuilderError('Unknown aggregation');
  const col = (v: unknown) => (typeof v === 'string' && v && v.length <= 200 ? v : undefined);
  const topN = c.top_n === null || c.top_n === undefined || c.top_n === '' ? null : Number(c.top_n);
  if (topN !== null && (!Number.isInteger(topN) || topN < 1 || topN > 200)) throw new BuilderError('Top N must be a whole number between 1 and 200');
  return { type: c.type, dimension: col(c.dimension), split: col(c.split), measure: { agg: m.agg, column: col(m.column) }, top_n: topN, other: c.other !== false, sort: SORTS.includes(c.sort) ? c.sort : 'value_desc' };
}
function cleanTiles(tiles: unknown): Tile[] {
  if (tiles === undefined) return [];
  if (!Array.isArray(tiles) || tiles.length > 40) throw new BuilderError('A canvas holds at most 40 tiles');
  return tiles.map((t: any) => {
    if (!t?.id || !t?.query_id) throw new BuilderError('Invalid tile');
    const v = t.query_version === 'latest' || t.query_version === undefined ? 'latest' : Number(t.query_version);
    if (v !== 'latest' && (!Number.isInteger(v) || v < 1)) throw new BuilderError('Invalid query version');
    return { id: String(t.id).slice(0, 60), query_id: String(t.query_id).slice(0, 60), query_version: v, title: text(t.title, 120, 'Tile title') || 'Untitled', chart: cleanChart(t.chart), w: [3, 4, 6, 8, 12].includes(Number(t.w)) ? Number(t.w) : 6, h: [2, 3, 4, 5, 6].includes(Number(t.h)) ? Number(t.h) : 3 };
  });
}

// ---------------- canvas CRUD ----------------
export const list = (u: string) => Object.values(read().canvases).filter((c) => canRead(c, u)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
export function get(id: string, u: string): Canvas {
  const c = read().canvases[id];
  if (!c || !canRead(c, u)) throw new HttpError('Canvas not found', 404);
  return c;
}
export async function create(b: any, u: string): Promise<Canvas> {
  const now = new Date().toISOString();
  const c: Canvas = { id: randomUUID(), name: text(b?.name, 120, 'name', true), owner: u, visibility: b?.visibility === 'team' ? 'team' : 'private', tiles: cleanTiles(b?.tiles), created_at: now, updated_at: now };
  await write((d) => { d.canvases[c.id] = c; });
  return c;
}
export async function update(id: string, b: any, u: string): Promise<Canvas> {
  const c = get(id, u);
  if (c.owner !== u) throw new HttpError('Only the owner can edit this canvas (duplicate it to make your own)', 403);
  const next: Canvas = { ...c, name: b?.name !== undefined ? text(b.name, 120, 'name', true) : c.name, visibility: b?.visibility === 'team' ? 'team' : b?.visibility === 'private' ? 'private' : c.visibility, tiles: b?.tiles !== undefined ? cleanTiles(b.tiles) : c.tiles, updated_at: new Date().toISOString() };
  await write((d) => { d.canvases[id] = next; });
  return next;
}
export async function remove(id: string, u: string) {
  const c = get(id, u);
  if (c.owner !== u) throw new HttpError('Only the owner can delete this canvas', 403);
  await write((d) => { delete d.canvases[id]; });
}
export const duplicate = (id: string, u: string) => { const c = get(id, u); return create({ name: `${c.name} (copy)`, tiles: c.tiles.map((t) => ({ ...t, id: randomUUID() })) }, u); };

// ---------------- chart data ----------------
export interface Col { name: string; type: string }
const NUMERIC = /^(tinyint|smallint|int|integer|bigint|long|float|double|decimal|numeric)/i;
export const isNumeric = (t: string) => NUMERIC.test(t);
/** Wrap the saved SQL as a sub-select; the newline protects against a trailing -- comment swallowing the bracket. */
const sub = (sql: string) => `(${sql}\n) q`;

export async function columnsOf(r: Resolved, token?: string, signal?: AbortSignal): Promise<Col[]> {
  return cached(`canvas-cols|${scopeOf(token)}|${r.sql}|${JSON.stringify(r.params)}`, async () => {
    // DESCRIBE cannot take parameter markers: describe the same statement with the (escaped) values inlined
    const rows = await query(`DESCRIBE QUERY ${inlineParams(r.sql, r.params)}`, {}, { userToken: token, signal });
    const out: Col[] = [];
    for (const r of rows) {
      const name = String(r.col_name ?? '');
      if (!name || name.startsWith('#')) break;
      out.push({ name, type: String(r.data_type ?? '') });
    }
    if (!out.length) throw new BuilderError('The saved query returns no columns');
    return out;
  }, { ttlMs: 5 * 60_000 });
}

const lbl = (c: string) => `COALESCE(NULLIF(CAST(${quoteIdent2(c)} AS STRING), ''), 'Unknown')`;
/** Column names come from the query's own schema and may contain spaces; quote with backticks (doubling any backtick). */
function quoteIdent2(c: string) { return '`' + c.replace(/`/g, '``') + '`'; }

function measureSql(m: Chart['measure'], cols: Col[]): string {
  if (m.agg === 'count') return 'COUNT(*)';
  const col = cols.find((c) => c.name === m.column);
  if (!col) throw new BuilderError(m.column ? `Unknown column “${m.column.slice(0, 60)}” for ${m.agg}` : `${m.agg} needs a column`);
  if (m.agg === 'count_distinct') return `COUNT(DISTINCT ${quoteIdent2(col.name)})`;
  if (!isNumeric(col.type)) throw new BuilderError(`${m.agg} needs a numeric column, but “${col.name}” is ${col.type}`);
  const c = quoteIdent2(col.name);
  return m.agg === 'avg' ? `ROUND(AVG(${c}), 4)` : `${m.agg.toUpperCase()}(${c})`;
}
function dimSql(name: string | undefined, cols: Col[], what: string): string {
  const c = cols.find((x) => x.name === name);
  if (!c) throw new BuilderError(name ? `Unknown ${what} column “${name.slice(0, 60)}”` : `Choose a ${what} column`);
  return lbl(c.name);
}

export interface ChartData { columns: Col[]; rows: Array<{ label: string; label2?: string; value: number | null; [k: string]: unknown }>; sql: string; total: number; capped: boolean; elapsedMs: number; grouped: boolean }
const ROW_CAP = 1000;

export async function chartData(src: Resolved | string, chartIn: unknown, token?: string, signal?: AbortSignal): Promise<ChartData> {
  const chart = cleanChart(chartIn);
  const r0: Resolved = typeof src === 'string' ? { sql: src, params: {} } : src;
  const sql = r0.sql;
  const cols = await columnsOf(r0, token, signal);
  const t0 = Date.now();
  let stmt: string;
  if (chart.type === 'table') {
    stmt = `SELECT * FROM ${sub(sql)} LIMIT ${ROW_CAP}`;
  } else if (chart.type === 'kpi') {
    stmt = `SELECT ${measureSql(chart.measure, cols)} AS value FROM ${sub(sql)}`;
  } else {
    const d1 = dimSql(chart.dimension, cols, 'dimension');
    const two = chart.type === 'stacked';
    const d2 = two ? dimSql(chart.split, cols, 'series') : null;
    const sortable = chart.type === 'line' || chart.type === 'area';
    const order = sortable || chart.sort === 'label_asc' ? 'label ASC' : chart.sort === 'label_desc' ? 'label DESC' : chart.sort === 'value_asc' ? 'value ASC NULLS LAST' : 'value DESC NULLS LAST';
    stmt = `SELECT ${d1} AS label${d2 ? `, ${d2} AS label2` : ''}, ${measureSql(chart.measure, cols)} AS value FROM ${sub(sql)} GROUP BY ${d2 ? '1, 2' : '1'} ORDER BY ${order}${d2 ? ', label2 ASC' : ''} LIMIT ${ROW_CAP}`;
  }
  const key = `canvas-data|${scopeOf(token)}|${stmt}|${JSON.stringify(r0.params)}`;
  const rows = await cached(key, () => query(stmt, r0.params, { userToken: token, signal }), { ttlMs: 5 * 60_000 });
  const elapsedMs = Date.now() - t0;
  if (chart.type === 'table') return { columns: cols, rows: rows as any, sql: stmt, total: rows.length, capped: rows.length >= ROW_CAP, elapsedMs, grouped: false };
  let out = rows.map((r) => ({ ...r, label: String(r.label ?? 'Unknown'), label2: r.label2 === undefined ? undefined : String(r.label2), value: r.value === null || r.value === undefined ? null : Number(r.value) }));
  if (chart.type === 'kpi') out = [{ label: 'Total', value: out[0]?.value ?? null } as any];
  // Top N + "Other" (only for additive measures: count / sum), single-dimension charts
  const additive = chart.measure.agg === 'count' || chart.measure.agg === 'sum';
  if (chart.top_n && out.length > chart.top_n && !chart.split && chart.type !== 'line' && chart.type !== 'area') {
    const head = out.slice(0, chart.top_n);
    if (additive && chart.other !== false) head.push({ label: 'Other', value: out.slice(chart.top_n).reduce((s, r) => s + (r.value ?? 0), 0) } as any);
    out = head;
  }
  return { columns: cols, rows: out as any, sql: stmt, total: out.reduce((s, r) => s + (r.value ?? 0), 0), capped: rows.length >= ROW_CAP, elapsedMs, grouped: true };
}

/** Run a tile on behalf of a viewer: permission follows the saved query (a shared canvas never leaks a private query). */
export async function runTile(tile: { query_id: string; query_version: 'latest' | number; chart: unknown }, user: string, token?: string, signal?: AbortSignal) {
  let q;
  try { q = getVersion(tile.query_id, user, tile.query_version === 'latest' ? undefined : tile.query_version); }
  catch (e) { return { state: 'no_access' as const, message: (e as Error).message === 'Saved query not found' ? 'This tile uses a saved query that was deleted or is not shared with you.' : (e as Error).message }; }
  try {
    const data = await chartData(resolve(q), tile.chart, token, signal);
    return { state: 'ok' as const, query: { id: q.id, name: q.name, version: q.version }, ...data };
  } catch (e) {
    if (e instanceof BuilderError) return { state: 'error' as const, message: e.message, query: { id: q.id, name: q.name, version: q.version } };
    // a warehouse error (for example the saved SQL no longer runs) is shown on the tile, with the statement for debugging
    return { state: 'error' as const, message: String((e as Error)?.message ?? e).slice(0, 600), query: { id: q.id, name: q.name, version: q.version } };
  }
}
