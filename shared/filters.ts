import { FILTER_FIELDS, GlobalFilters, Group, Node, emptyGroup, type ExtraFilter } from './types';
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

/**
 * VOC priority and OS family are filters on a column that lives on ONE table (findings, assets).
 * They are expressed as bridge-aware filters, so every card responds to them: a finding-level filter on an asset card keeps
 * assets that have an open matching finding, an asset-level filter on a finding card keeps findings on matching assets.
 */
export function derivedExtras(f: GlobalFilters): ExtraFilter[] {
  const out: ExtraFilter[] = [];
  const list = (field: string, entity: 'assets' | 'vulnerabilities', vals: string[] | undefined, id: string) => {
    if (vals?.length) out.push({ id, entity, condition: { type: 'condition', field: L(field), operator: vals.length === 1 ? 'is' : 'is one of', value: vals.length === 1 ? vals[0] : vals, not: false } });
  };
  list('priority_code', 'vulnerabilities', f.priority, 'f:priority');
  list('os_type', 'assets', f.os_family, 'f:os_family');
  return out;
}

export const countActiveFilters = (f: GlobalFilters) =>
  FILTER_FIELDS.reduce((n, k) => n + (f[k].length ? 1 : 0), 0) + (f.internet_exposed !== 'all' ? 1 : 0) + (f.extra?.length ?? 0)
  + (f.priority?.length ? 1 : 0) + (f.os_family?.length ? 1 : 0);
