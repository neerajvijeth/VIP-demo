import type { Entity } from '../shared/types';
import { applyLiveSchema, getSchemaInfo, tableName } from './fieldCatalog';
import { entityTable } from './config';
import { query } from './db';

const ENTITIES: Entity[] = ['assets', 'vulnerabilities'];
let inflight: Promise<void> | null = null;
let lastAttempt = 0;

/** Discovers columns + data types from the warehouse (DESCRIBE TABLE) and rebuilds the field catalog. */
export function syncSchema(userToken?: string): Promise<void> {
  inflight ??= (async () => {
    lastAttempt = Date.now();
    for (const e of ENTITIES) {
      try {
        const rows = await query(`DESCRIBE TABLE ${entityTable(e)}`, {}, { userToken });
        const cols: { name: string; dataType: string }[] = [];
        for (const r of rows) {
          const name = String(r.col_name ?? '');
          if (!name || name.startsWith('#')) break; // partition / detail sections follow the column list
          cols.push({ name, dataType: String(r.data_type ?? '') });
        }
        if (!cols.length) continue;
        const { added, dropped, retyped } = applyLiveSchema(e, cols);
        console.log(`[schema] ${tableName(e)}: ${cols.length} columns discovered; ${added.length} added to filters` + (dropped.length ? `; dropped from catalog: ${dropped.join(', ')}` : '') + (retyped.length ? `; retyped from live schema: ${retyped.join(', ')}` : ''));
      } catch (err: any) {
        console.warn(`[schema] DESCRIBE ${tableName(e)} failed, keeping previous schema: ${err?.message}`);
      }
    }
  })().finally(() => (inflight = null));
  return inflight;
}

/** Re-sync lazily when the cached schema is older than `maxAgeMs`. */
export async function ensureFreshSchema(maxAgeMs = 30 * 60_000, userToken?: string) {
  const stale = ENTITIES.some((e) => !getSchemaInfo(e) || Date.now() - getSchemaInfo(e)!.syncedAt > maxAgeMs);
  // Back off for a minute after a failed attempt so an unreachable warehouse is not hammered.
  if (stale && Date.now() - lastAttempt > 60_000) await syncSchema(userToken);
}
