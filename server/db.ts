import { DBSQLClient } from '@databricks/sql';
import type IDBSQLSession from '@databricks/sql/dist/contracts/IDBSQLSession';
import type IOperation from '@databricks/sql/dist/contracts/IOperation';
import { config } from './config';
import { toJsonSafe } from './serialize';
import { cliProfileToken } from './auth';

type Params = Record<string, string | number | boolean>;

let shared: Promise<DBSQLClient> | null = null;

const httpPath = () => `/sql/1.0/warehouses/${config.warehouseId}`;

async function connectShared(): Promise<DBSQLClient> {
  const client = new DBSQLClient();
  const base = { host: config.host, path: httpPath() };
  if (config.clientId && config.clientSecret) {
    await client.connect({ ...base, authType: 'databricks-oauth', oauthClientId: config.clientId, oauthClientSecret: config.clientSecret });
  } else if (config.token) {
    await client.connect({ ...base, authType: 'access-token', token: config.token });
  } else {
    throw new Error('No Databricks credentials configured (set DATABRICKS_CLIENT_ID/SECRET or DATABRICKS_TOKEN)');
  }
  return client;
}

async function getClient(userToken?: string): Promise<{ client: DBSQLClient; owned: boolean }> {
  // Local dev with a CLI profile: tokens are short-lived, so connect per request.
  userToken ??= config.token ? undefined : cliProfileToken();
  if (userToken) {
    const client = new DBSQLClient();
    await client.connect({ host: config.host, path: httpPath(), authType: 'access-token', token: userToken });
    return { client, owned: true };
  }
  if (!config.host || !config.warehouseId) throw new Error('DATABRICKS_HOST and DATABRICKS_WAREHOUSE_ID must be set');
  if (!shared) shared = connectShared().catch((e) => ((shared = null), Promise.reject(e)));
  return { client: await shared, owned: false };
}

async function withSession<T>(userToken: string | undefined, fn: (s: IDBSQLSession) => Promise<T>): Promise<T> {
  const { client, owned } = await getClient(userToken);
  const session = await client.openSession({ configuration: { STATEMENT_TIMEOUT: String(config.statementTimeoutSec) } });
  try {
    return await fn(session);
  } finally {
    await session.close().catch(() => undefined);
    if (owned) await client.close().catch(() => undefined);
  }
}

/** What this app has asked of the warehouse since the process started (visible at /api/health). */
export const warehouseStats = { statements: 0, errors: 0, totalMs: 0, startedAt: Date.now() };
const track = async <T>(fn: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  warehouseStats.statements++;
  try {
    return await fn();
  } catch (e) {
    warehouseStats.errors++;
    throw e;
  } finally {
    warehouseStats.totalMs += Date.now() - t;
  }
};

export interface QueryOpts {
  userToken?: string;
  signal?: AbortSignal;
}

/** Cancels the running statement when the abort signal fires. */
function hookAbort(op: IOperation, signal?: AbortSignal) {
  if (!signal) return () => undefined;
  const cancel = () => void op.cancel().catch(() => undefined);
  if (signal.aborted) cancel();
  signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

/** Runs a parameterized statement and returns JSON-safe rows. */
export function query(sql: string, params: Params = {}, opts: QueryOpts = {}): Promise<Record<string, unknown>[]> {
  return track(() => queryInner(sql, params, opts));
}
async function queryInner(sql: string, params: Params, opts: QueryOpts): Promise<Record<string, unknown>[]> {
  return withSession(opts.userToken, async (session) => {
    const op = await session.executeStatement(sql, { namedParameters: params, runAsync: true, maxRows: 10_000 });
    const unhook = hookAbort(op, opts.signal);
    try {
      const rows = (await op.fetchAll({ maxRows: 10_000 })) as Record<string, unknown>[];
      return rows.map((r) => toJsonSafe(r) as Record<string, unknown>);
    } finally {
      unhook();
      await op.close().catch(() => undefined);
    }
  });
}

/** Streams rows in chunks; `onChunk` may await (backpressure). Returns the number of rows delivered. */
export function streamQuery(
  sql: string,
  params: Params,
  onChunk: (rows: Record<string, unknown>[]) => Promise<boolean | void>,
  opts: QueryOpts & { chunkSize?: number; onSchema?: (columns: string[]) => void | Promise<void> } = {},
): Promise<number> {
  return track(() => streamInner(sql, params, onChunk, opts));
}
async function streamInner(
  sql: string,
  params: Params,
  onChunk: (rows: Record<string, unknown>[]) => Promise<boolean | void>,
  opts: QueryOpts & { chunkSize?: number; onSchema?: (columns: string[]) => void | Promise<void> },
): Promise<number> {
  return withSession(opts.userToken, async (session) => {
    const op = await session.executeStatement(sql, { namedParameters: params, runAsync: true, maxRows: 10_000 });
    const unhook = hookAbort(op, opts.signal);
    let n = 0;
    try {
      if (opts.onSchema) {
        const schema = await op.getSchema();
        await opts.onSchema((schema?.columns ?? []).map((c) => String(c.columnName)));
      }
      do {
        if (opts.signal?.aborted) break;
        const rows = (await op.fetchChunk({ maxRows: opts.chunkSize ?? 5000 })) as Record<string, unknown>[];
        if (rows.length) {
          n += rows.length;
          if ((await onChunk(rows.map((r) => toJsonSafe(r) as Record<string, unknown>))) === false) break;
        }
      } while (await op.hasMoreRows());
      return n;
    } finally {
      unhook();
      await op.close().catch(() => undefined);
    }
  });
}

/** Read-only ad-hoc statement: returns column names (from the schema, so empty results keep headers) and up to `maxRows` rows. */
export function runReadOnly(sql: string, opts: QueryOpts & { maxRows: number }): Promise<{ columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }> {
  return track(() => runReadOnlyInner(sql, opts));
}
async function runReadOnlyInner(sql: string, opts: QueryOpts & { maxRows: number }): Promise<{ columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }> {
  return withSession(opts.userToken, async (session) => {
    const op = await session.executeStatement(sql, { runAsync: true, maxRows: 10_000 });
    const unhook = hookAbort(op, opts.signal);
    try {
      const schema = await op.getSchema();
      const columns = (schema?.columns ?? []).map((c) => String(c.columnName));
      const rows: Record<string, unknown>[] = [];
      let truncated = false;
      do {
        const chunk = (await op.fetchChunk({ maxRows: Math.min(5000, opts.maxRows + 1) })) as Record<string, unknown>[];
        for (const r of chunk) {
          if (rows.length >= opts.maxRows) { truncated = true; break; }
          rows.push(toJsonSafe(r) as Record<string, unknown>);
        }
        if (truncated) break;
      } while (await op.hasMoreRows());
      return { columns, rows, truncated };
    } finally {
      unhook();
      await op.close().catch(() => undefined);
    }
  });
}

export async function pingWarehouse(): Promise<number> {
  const t = Date.now();
  await query('SELECT 1 AS ok');
  return Date.now() - t;
}

/** Process-wide limiter: at most `max` tasks run at once, the rest queue (FIFO). */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((ok) => waiting.push(ok));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/** Runs async tasks with a concurrency limit, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}
