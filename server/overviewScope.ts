import type { Condition, Entity, ExtraFilter, Group, QueryOptions } from '../shared/types';
import { L } from '../shared/semantics';
import { BuilderError, buildWhere, ParamBag, quoteIdent, treeToSql } from './sqlBuilder';
import { canonicalSource } from './overviewSource';
import { makeCtx } from './overviewWidgets';

export const MAX_EXTRA = 20;
const grp = (children: Condition[]): Group => ({ type: 'group', op: 'AND', not: false, children });

/**
 * Validates user-added Overview filters. Every condition is dry-run through the same allow-listed builder as the query pages
 * (known field, operator valid for its type, values bound as parameters), so anything else is rejected before a widget runs.
 */
export function cleanExtras(raw: unknown): ExtraFilter[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_EXTRA) throw new BuilderError(`At most ${MAX_EXTRA} extra filters`);
  return raw.map((x: any, i) => {
    if (!x || (x.entity !== 'assets' && x.entity !== 'vulnerabilities') || x.condition?.type !== 'condition') throw new BuilderError(`Invalid filter #${i + 1}`);
    const c = x.condition;
    const condition: Condition = { type: 'condition', field: c.field, operator: c.operator, value: c.value, not: c.not === true };
    treeToSql(x.entity, grp([condition]), new ParamBag()); // throws BuilderError on unknown field / bad operator / bad value
    return { id: String(x.id ?? i).slice(0, 40), entity: x.entity as Entity, condition };
  });
}

/**
 * WHERE clause for one widget.
 *  - fixed filters (exist on both tables): `tree` as before
 *  - extra filter on the widget's own table: AND-ed into the tree
 *  - extra filter on the OTHER table: bridged through the asset id.
 *      finding widgets: keep findings whose asset matches the asset filters
 *      asset widgets:   keep assets that have an OPEN finding matching the finding filters
 */
export function widgetScope(entity: Entity, tree: Group, extras: ExtraFilter[], opts: QueryOptions): { where: string; params: Record<string, string | number | boolean> } {
  const bag = new ParamBag();
  const own = extras.filter((e) => e.entity === entity).map((e) => e.condition);
  const other = extras.filter((e) => e.entity !== entity).map((e) => e.condition);
  const { where } = buildWhere(entity, { ...tree, children: [...tree.children, ...own] }, opts, bag);
  if (!other.length) return { where, params: bag.params };
  const otherEntity: Entity = entity === 'assets' ? 'vulnerabilities' : 'assets';
  const cross = buildWhere(otherEntity, grp(other), opts, bag);
  const id = quoteIdent(L('gold_asset_id'));
  const openPart = otherEntity === 'vulnerabilities' ? ` AND ${makeCtx('t', '').open()}` : '';
  return { where: `${where} AND ${id} IN (SELECT ${id} FROM ${canonicalSource(otherEntity)} ${cross.where}${openPart})`, params: bag.params };
}
