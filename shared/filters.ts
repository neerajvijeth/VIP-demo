import { FILTER_FIELDS, GlobalFilters, Group, Node, emptyGroup } from './types';
import { L } from './semantics';

/** Turns the Overview global filters into a builder tree (AND across filters, OR within one). */
export function filtersToTree(f: GlobalFilters): Group {
  const children: Node[] = [];
  for (const k of FILTER_FIELDS) {
    const vals = f[k];
    if (!vals?.length) continue;
    children.push(
      vals.length === 1
        ? { type: 'condition', field: L(k), operator: 'is', value: vals[0], not: false }
        : { type: 'condition', field: L(k), operator: 'is one of', value: vals, not: false },
    );
  }
  if (f.internet_exposed === 'yes') children.push({ type: 'condition', field: L('internet_exposed'), operator: 'is true', value: null, not: false });
  if (f.internet_exposed === 'no') children.push({ type: 'condition', field: L('internet_exposed'), operator: 'is false', value: null, not: false });
  return { ...emptyGroup(), children };
}

export const countActiveFilters = (f: GlobalFilters) =>
  FILTER_FIELDS.reduce((n, k) => n + (f[k].length ? 1 : 0), 0) + (f.internet_exposed !== 'all' ? 1 : 0);
