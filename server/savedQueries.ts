import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { validateCustomSql } from './customSql';
import { BuilderError } from './sqlBuilder';

/**
 * Server-side saved queries (Custom SQL). Per user, private or team, versioned with rollback.
 * Storage: a JSON file (VIP_DATA_DIR, default ./.vip-data). Databricks Apps disks are ephemeral; swap `Store` for a Delta table in production.
 */
export interface SavedQuery {
  id: string; name: string; description: string; owner: string; visibility: 'private' | 'team';
  sql: string; version: number; created_at: string; updated_at: string;
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
class HttpError extends BuilderError { constructor(m: string, public status: number) { super(m); } }
const canRead = (q: SavedQuery, u: string) => q.owner === u || q.visibility === 'team';
const text = (v: unknown, max: number, what: string, req = false) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s && req) throw new BuilderError(`${what} is required`); if (s.length > max) throw new BuilderError(`${what} is too long`); return s; };

export const list = (u: string) => Object.values(read().queries).map((r) => r.current).filter((q) => canRead(q, u)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
export function get(id: string, u: string) { const r = read().queries[id]; if (!r || !canRead(r.current, u)) throw new HttpError('Saved query not found', 404); return r; }

export async function create(b: any, u: string): Promise<SavedQuery> {
  const now = new Date().toISOString();
  const q: SavedQuery = { id: randomUUID(), name: text(b?.name, 120, 'name', true), description: text(b?.description, 1000, 'description'), owner: u, visibility: b?.visibility === 'team' ? 'team' : 'private', sql: validateCustomSql(b?.sql), version: 1, created_at: now, updated_at: now };
  await write((d) => { d.queries[q.id] = { current: q, versions: [] }; });
  return q;
}
export async function update(id: string, b: any, u: string): Promise<SavedQuery> {
  const r = get(id, u);
  if (r.current.owner !== u) throw new HttpError('Only the owner can edit this query (duplicate it for your own copy)', 403);
  const sqlChanged = b?.sql !== undefined && b.sql !== r.current.sql;
  const next: SavedQuery = { ...r.current, name: b?.name !== undefined ? text(b.name, 120, 'name', true) : r.current.name, description: b?.description !== undefined ? text(b.description, 1000, 'description') : r.current.description, visibility: b?.visibility === 'team' ? 'team' : b?.visibility === 'private' ? 'private' : r.current.visibility, sql: sqlChanged ? validateCustomSql(b.sql) : r.current.sql, version: r.current.version + (sqlChanged ? 1 : 0), updated_at: new Date().toISOString() };
  await write((d) => { const x = d.queries[id]; if (sqlChanged) x.versions.push(x.current); x.current = next; });
  return next;
}
export async function rollback(id: string, version: number, u: string): Promise<SavedQuery> {
  const r = get(id, u);
  if (r.current.owner !== u) throw new HttpError('Only the owner can roll back', 403);
  const old = r.versions.find((v) => v.version === version);
  if (!old) throw new HttpError(`Version ${version} not found`, 404);
  const next = { ...r.current, sql: old.sql, version: r.current.version + 1, updated_at: new Date().toISOString() };
  await write((d) => { const x = d.queries[id]; x.versions.push(x.current); x.current = next; });
  return next;
}
export async function remove(id: string, u: string) {
  const r = get(id, u);
  if (r.current.owner !== u) throw new HttpError('Only the owner can delete this query', 403);
  await write((d) => { delete d.queries[id]; });
}
export const duplicate = (id: string, u: string) => { const r = get(id, u); return create({ name: `${r.current.name} (copy)`, description: r.current.description, sql: r.current.sql }, u); };
export const versions = (id: string, u: string) => { const r = get(id, u); return [r.current, ...[...r.versions].reverse()].map((v) => ({ version: v.version, updated_at: v.updated_at })); };
