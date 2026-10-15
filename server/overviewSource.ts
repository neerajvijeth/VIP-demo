import type { Entity } from '../shared/types';
import { L } from '../shared/semantics';
import { entityTable } from './config';
import { isSelectableColumn } from './fieldCatalog';
import { quoteIdent } from './sqlBuilder';

/**
 * What the Overview counts. Instead of the raw gold tables, every widget reads one of these derived tables:
 *  - assets:   one row per asset per snapshot (best source rank, newest run of that day), not purged, not terminated
 *  - findings: de-duplicated (deduplication_status <> Duplicate), only on assets that are in the asset set above,
 *              with the asset columns (business unit, region, criticality, ...) taken from the asset row, not from
 *              the copies stored on the findings table (which can be stale or empty).
 * Global filters, the snapshot switch and the validity switch are applied on top by the existing WHERE builder.
 */
const q = (n: string) => quoteIdent(n);
const has = (e: Entity, logical: string) => isSelectableColumn(e, L(logical));

/** Newest run (snapshot_timestamp) of each snapshot_date: older partial runs of the same day are ignored. */
function latestRunJoin(e: Entity, alias: string): string {
  if (!has(e, 'snapshot_date') || !has(e, 'snapshot_timestamp')) return '';
  const d = q(L('snapshot_date')), ts = q(L('snapshot_timestamp'));
  return `JOIN (SELECT ${d} AS _d, MAX(${ts}) AS _ts FROM ${entityTable(e)} GROUP BY ${d}) _m ON ${alias}.${d} = _m._d AND ${alias}.${ts} = _m._ts`;
}

function assetsInner(): string {
  const id = q(L('gold_asset_id'));
  const where = [`x.${id} IS NOT NULL`];
  if (has('assets', 'is_purged')) where.push(`COALESCE(x.${q(L('is_purged'))}, false) = false`);
  if (has('assets', 'terminated_at')) where.push(`x.${q(L('terminated_at'))} IS NULL`);
  const part = [`x.${id}`, has('assets', 'snapshot_date') ? `x.${q(L('snapshot_date'))}` : ''].filter(Boolean).join(', ');
  const order = ['canonical_source_rank', 'source_rank'].filter((c) => has('assets', c)).map((c) => `x.${q(L(c))} ASC NULLS LAST`);
  if (has('assets', 'snapshot_timestamp')) order.push(`x.${q(L('snapshot_timestamp'))} DESC`);
  return `SELECT * EXCEPT (_rn) FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY ${part} ORDER BY ${order.join(', ') || 'x.' + id}) AS _rn FROM ${entityTable('assets')} x ${latestRunJoin('assets', 'x')} WHERE ${where.join(' AND ')}) WHERE _rn = 1`;
}

/** Asset attributes the Overview filters / groups by; taken from the asset row for findings. */
export const ASSET_ATTRS = ['hostname', 'business_unit', 'region', 'country', 'criticality', 'asset_class', 'device_type', 'device_role', 'internet_exposed', 'domain', 'data_center', 'os_type', 'os_name', 'os_distribution'];

/** Is `col` usable in this entity's source? Finding sources also carry the asset attributes above, even when the raw findings table lacks them. */
export const columnAvailable = (entity: Entity, col: string): boolean =>
  isSelectableColumn(entity, col) || (entity === 'vulnerabilities' && ASSET_ATTRS.some((a) => L(a) === col) && isSelectableColumn('assets', col));

export function canonicalSource(entity: Entity): string {
  if (entity === 'assets') return `(${assetsInner()}) t`;
  const id = q(L('gold_asset_id'));
  // every asset attribute the asset row has; those the findings table also carries are replaced (EXCEPT), the others are added
  const attrs = ASSET_ATTRS.filter((a) => has('assets', a));
  const dup = attrs.filter((a) => has('vulnerabilities', a));
  const except = dup.length ? ` EXCEPT (${dup.map((a) => q(L(a))).join(', ')})` : '';
  const take = attrs.map((a) => `a.${q(L(a))}`);
  if (has('assets', 'criticality_normalization_method')) take.push(`a.${q(L('criticality_normalization_method'))} AS ${q('asset_criticality_method')}`);
  const snapJoin = has('assets', 'snapshot_date') && has('vulnerabilities', 'snapshot_date') ? ` AND a.${q(L('snapshot_date'))} = f.${q(L('snapshot_date'))}` : '';
  const where = has('vulnerabilities', 'deduplication_status') ? `WHERE COALESCE(f.${q(L('deduplication_status'))}, 'Unique') <> 'Duplicate'` : '';
  return `(SELECT f.*${except}${take.length ? ', ' + take.join(', ') : ''} FROM ${entityTable('vulnerabilities')} f ${latestRunJoin('vulnerabilities', 'f')} JOIN (${assetsInner()}) a ON a.${id} = f.${id}${snapJoin} ${where}) t`;
}
