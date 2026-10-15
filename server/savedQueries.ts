import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { BuilderError } from './sqlBuilder';
import { cleanPayload, resolve, type BuilderPayload } from './savedResolve';

/**
 * Server-side saved queries (Custom SQL). Per user, private or team, versioned with rollback.
 * Storage: a JSON file (VIP_DATA_DIR, default ./.vip-data). Databricks Apps disks are ephemeral; swap `Store` for a Delta table in production.
 */
export interface SavedQuery {
  id: string; name: string; description: string; owner: string; visibility: 'private' | 'team';
  kind: 'sql' | 'builder';
  /** kind=sql: the statement. kind=builder: empty (SQL is generated from `payload`) */
  sql: string;
  /** kind=builder only */
  entity?: 'assets' | 'vulnerabilities';
  payload?: BuilderPayload;
  version: number; created_at: string; updated_at: string;
}
interface Doc { queries: Record<string, { current: SavedQuery; versions: SavedQuery[] }> }

const file = path.resolve(process.env.VIP_DATA_DIR || '.vip-data', 'saved-queries.json');
let doc: Doc | null = null;
let chain: Promise<unknown> = Promise.resolve();
const read = (): Doc => (doc ??= (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { queries: {} }; } })());
function write(mut: (d: Doc) => void) {
  const run = async () => { const d = read(); mut(d); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(file + '.tmp', file); };
  const p = chain.then(run, run); chain = p.catch(() => undefined); return p;
}

export const userOf = (req?: Request) => String(req?.headers['x-forwarded-email'] ?? req?.headers['x-forwarded-preferred-username'] ?? process.env.USER ?? 'local-user').slice(0, 200);
export class HttpError extends BuilderError { constructor(m: string, public status: number) { super(m); } }
const canRead = (q: SavedQuery, u: string) => q.owner === u || q.visibility === 'team';
const text = (v: unknown, max: number, what: string, req = false) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s && req) throw new BuilderError(`${what} is required`); if (s.length > max) throw new BuilderError(`${what} is too long`); return s; };

const norm = (q: SavedQuery): SavedQuery => (q.kind ? q : { ...q, kind: 'sql' }); // records saved before builder queries existed are SQL
export const list = (u: string) => Object.values(read().queries).map((r) => norm(r.current)).filter((q) => canRead(q, u)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
export function get(id: string, u: string) { const r = read().queries[id]; if (!r || !canRead(r.current, u)) throw new HttpError('Saved query not found', 404); return r; }

export async function create(b: any, u: string): Promise<SavedQuery> {
  const now = new Date().toISOString();
  const kind = b?.kind === 'builder' ? 'builder' : 'sql';
  const base = { id: randomUUID(), name: text(b?.name, 120, 'name', true), description: text(b?.description, 1000, 'description'), owner: u, visibility: (b?.visibility === 'team' ? 'team' : 'private') as 'private' | 'team', version: 1, created_at: now, updated_at: now };
  let q: SavedQuery;
  if (kind === 'builder') {
    const entity = b?.entity;
    if (entity !== 'assets' && entity !== 'vulnerabilities') throw new BuilderError('entity must be assets or vulnerabilities');
    q = { ...base, kind, sql: '', entity, payload: cleanPayload(b.payload) };
  } else q = { ...base, kind, sql: resolve({ kind: 'sql', sql: b?.sql }).sql };
  if (kind === 'builder') resolve(q); // refuse to store a query that cannot generate SQL now (unknown field, bad operator, ...)
  await write((d) => { d.queries[q.id] = { current: q, versions: [] }; });
  return q;
}
export async function update(id: string, b: any, u: string): Promise<SavedQuery> {
  const r = get(id, u);
  const cur = r.current;
  if (cur.owner !== u) throw new HttpError('Only the owner can edit this query (duplicate it for your own copy)', 403);
  const next: SavedQuery = { ...cur, kind: cur.kind ?? 'sql', name: b?.name !== undefined ? text(b.name, 120, 'name', true) : cur.name, description: b?.description !== undefined ? text(b.description, 1000, 'description') : cur.description, visibility: b?.visibility === 'team' ? 'team' : b?.visibility === 'private' ? 'private' : cur.visibility, updated_at: new Date().toISOString() };
  let changed = false;
  if (next.kind === 'builder') {
    if (b?.payload !== undefined) { next.payload = cleanPayload(b.payload); changed = JSON.stringify(next.payload) !== JSON.stringify(cur.payload); resolve(next); }
  } else if (b?.sql !== undefined && b.sql !== cur.sql) { next.sql = resolve({ kind: 'sql', sql: b.sql }).sql; changed = true; }
  if (changed) next.version = cur.version + 1;
  await write((d) => { const x = d.queries[id]; if (changed) x.versions.push(x.current); x.current = next; });
  return next;
}
export async function rollback(id: string, version: number, u: string): Promise<SavedQuery> {
  const r = get(id, u);
  if (r.current.owner !== u) throw new HttpError('Only the owner can roll back', 403);
  const old = r.versions.find((v) => v.version === version);
  if (!old) throw new HttpError(`Version ${version} not found`, 404);
  const next: SavedQuery = { ...r.current, sql: old.sql, payload: old.payload, version: r.current.version + 1, updated_at: new Date().toISOString() };
  await write((d) => { const x = d.queries[id]; x.versions.push(x.current); x.current = next; });
  return next;
}
export async function remove(id: string, u: string) {
  const r = get(id, u);
  if (r.current.owner !== u) throw new HttpError('Only the owner can delete this query', 403);
  await write((d) => { delete d.queries[id]; });
}
/** The query as of a version (undefined = latest). Same read permission as get(). */
export function getVersion(id: string, u: string, version?: number): SavedQuery {
  const r = get(id, u);
  if (version === undefined || version === r.current.version) return norm(r.current);
  const v = r.versions.find((x) => x.version === version);
  if (!v) throw new HttpError(`Version ${version} not found`, 404);
  return norm(v);
}
export const duplicate = (id: string, u: string) => { const c = norm(get(id, u).current); return create({ kind: c.kind, name: `${c.name} (copy)`, description: c.description, sql: c.sql, entity: c.entity, payload: c.payload }, u); };
export const versions = (id: string, u: string) => { const r = get(id, u); return [r.current, ...[...r.versions].reverse()].map((v) => ({ version: v.version, updated_at: v.updated_at })); };
