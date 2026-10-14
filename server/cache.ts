import { createHash } from 'node:crypto';
import { config } from './config';

interface Entry { at: number; value: unknown }
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 500;

export const cacheStats = { hits: 0, misses: 0, deduped: 0 };

/** Cache namespace: results from a user's own token (OBO) must never be served to someone else. */
export const scopeOf = (userToken?: string) => (userToken ? 'u:' + createHash('sha1').update(userToken).digest('hex').slice(0, 12) : 'app');

/**
 * Short-lived result cache + in-flight de-duplication for read-only dashboard queries.
 * Identical statements issued within the TTL (default 5 min, CACHE_TTL_SECONDS) hit the warehouse once.
 * `fresh` bypasses the read but still stores the new result (used by the manual Refresh button).
 */
export async function cached<T>(key: string, fn: () => Promise<T>, opts: { fresh?: boolean; ttlMs?: number } = {}): Promise<T> {
  const ttl = opts.ttlMs ?? config.cacheTtlMs;
  if (ttl <= 0) return fn();
  const hit = store.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < ttl) {
    cacheStats.hits++;
    return hit.value as T;
  }
  const running = inflight.get(key);
  if (running && !opts.fresh) {
    cacheStats.deduped++;
    return running as Promise<T>;
  }
  cacheStats.misses++;
  const p = fn()
    .then((v) => {
      store.set(key, { at: Date.now(), value: v });
      if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
export const clearCache = () => store.clear();
