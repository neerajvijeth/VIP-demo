import type { Condition, Entity, FieldDef, Group, Node, QueryOptions, SummarySpec } from '@shared/types';
import { MULTI_OPS, NO_VALUE_OPS, OPERATORS, emptyGroup } from '@shared/types';
import { uid } from './utils';
import { L } from '@shared/semantics';
import { critHighCond, lcond, openCond } from './sem';

// ---------- ids & construction ----------
export const newCondition = (field?: FieldDef): Condition => ({
  id: uid(),
  type: 'condition',
  field: field?.key ?? '',
  operator: field ? OPERATORS[field.type][0] : '',
  value: null,
  not: false,
});
export const newGroup = (op: 'AND' | 'OR' = 'AND'): Group => ({ id: uid(), type: 'group', op, not: false, children: [] });

export function withIds<T extends Node>(n: T): T {
  if (n.type === 'group') return { ...n, id: n.id ?? uid(), children: n.children.map(withIds) } as T;
  return { ...n, id: n.id ?? uid() } as T;
}
export const freshTree = (): Group => ({ ...emptyGroup(), id: uid() });

// ---------- immutable updates ----------
export function mapTree(n: Node, fn: (n: Node) => Node | null): Node | null {
  const mapped = fn(n);
  if (!mapped) return null;
  if (mapped.type === 'group') {
    return { ...mapped, children: mapped.children.map((c) => mapTree(c, fn)).filter((c): c is Node => !!c) };
  }
  return mapped;
}
export const updateNode = (root: Group, id: string, patch: Partial<Condition> | Partial<Group>): Group =>
  mapTree(root, (n) => (n.id === id ? ({ ...n, ...patch } as Node) : n)) as Group;
/** Set the group's default AND/OR and reset every per-connector override. */
export const setGroupOp = (root: Group, id: string, op: 'AND' | 'OR'): Group =>
  mapTree(root, (n) => (n.id === id && n.type === 'group' ? { ...n, op, children: n.children.map((c) => ({ ...c, join: undefined })) } : n)) as Group;
export const removeNode = (root: Group, id: string): Group => mapTree(root, (n) => (n.id === id ? null : n)) as Group;
export function addChild(root: Group, groupId: string, child: Node): Group {
  return mapTree(root, (n) => (n.id === groupId && n.type === 'group' ? { ...n, children: [...n.children, child] } : n)) as Group;
}
export function duplicateNode(root: Group, id: string): Group {
  const clone = (n: Node): Node => (n.type === 'group' ? { ...n, id: uid(), children: n.children.map(clone) } : { ...n, id: uid() });
  const dupChildren = (g: Group): Group => ({
    ...g,
    children: g.children.flatMap((c) => {
      const mapped = c.type === 'group' ? dupChildren(c) : c;
      return c.id === id ? [mapped, clone(c)] : [mapped];
    }),
  });
  return dupChildren(root);
}
export function findNode(root: Node, id: string): Node | null {
  if (root.id === id) return root;
  if (root.type === 'group') for (const c of root.children) { const f = findNode(c, id); if (f) return f; }
  return null;
}
export function findParent(root: Group, id: string): Group | null {
  for (const c of root.children) {
    if (c.id === id) return root;
    if (c.type === 'group') { const f = findParent(c, id); if (f) return f; }
  }
  return null;
}
const contains = (n: Node, id: string): boolean => !!findNode(n, id);

/** Wrap a condition/group in its own bracketed group: `x` becomes `( x )`. */
export function wrapNode(root: Group, id: string): Group {
  return mapTree(root, (n) => (n.id === id ? { ...newGroup('AND'), children: [n] } : n)) as Group;
}
/** Remove a group's brackets, lifting its children into the parent at the same position. */
export function unwrapGroup(root: Group, id: string): Group {
  const walk = (g: Group): Group => ({
    ...g,
    children: g.children.flatMap((c) => (c.type === 'group' ? (c.id === id ? c.children.map((k) => (k.type === 'group' ? walk(k) : k)) : [walk(c)]) : [c])),
  });
  return walk(root);
}

/**
 * Move `activeId` into group `targetGroupId`. `index` is the final position in that group's
 * children (dnd-kit "over" index); undefined appends. Prevents moving a group into itself.
 */
export function moveNode(root: Group, activeId: string, targetGroupId: string, index?: number): Group {
  const active = findNode(root, activeId);
  if (!active || active.id === root.id) return root;
  if (active.type === 'group' && contains(active, targetGroupId)) return root;
  const without = removeNode(root, activeId);
  return mapTree(without, (n) => {
    if (n.id !== targetGroupId || n.type !== 'group') return n;
    const kids = [...n.children];
    kids.splice(index ?? kids.length, 0, active);
    return { ...n, children: kids };
  }) as Group;
}

// ---------- validity / cleaning ----------
export function isComplete(c: Condition, fields: Map<string, FieldDef>): boolean {
  const f = fields.get(c.field);
  if (!f || !OPERATORS[f.type].includes(c.operator)) return false;
  if (NO_VALUE_OPS.has(c.operator)) return true;
  const v = c.value;
  if (MULTI_OPS.has(c.operator)) return Array.isArray(v) && v.length > 0;
  if (c.operator === 'between') return Array.isArray(v) && v.length === 2 && v.every((x) => x !== '' && x !== null && x !== undefined);
  return v !== '' && v !== null && v !== undefined;
}

/** Strips client ids and drops incomplete conditions / empty groups, ready for the API. */
export function cleanTree(root: Group, fields: Map<string, FieldDef>): Group {
  const walk = (n: Node): Node | null => {
    if (n.type === 'condition') {
      if (!isComplete(n, fields)) return null;
      return { type: 'condition', field: n.field, operator: n.operator, value: NO_VALUE_OPS.has(n.operator) ? null : n.value, not: !!n.not, ...(n.join ? { join: n.join } : {}) };
    }
    const kids = n.children.map(walk).filter((c): c is Node => !!c);
    if (!kids.length) return null;
    return { type: 'group', op: n.op, not: !!n.not, children: kids, ...(n.join ? { join: n.join } : {}) };
  };
  return (walk(root) as Group | null) ?? { type: 'group', op: 'AND', not: false, children: [] };
}
export const countConditions = (n: Node): number => (n.type === 'condition' ? 1 : n.children.reduce((s, c) => s + countConditions(c), 0));
export const countIncomplete = (root: Group, fields: Map<string, FieldDef>): number => {
  const walk = (n: Node): number => (n.type === 'condition' ? (isComplete(n, fields) ? 0 : 1) : n.children.reduce((s, c) => s + walk(c), 0));
  return walk(root);
};
export const treeDepth = (n: Node): number => (n.type === 'condition' ? 0 : 1 + Math.max(0, ...n.children.map(treeDepth)));

// ---------- readable expression ----------
export type Tok = { k: 'field' | 'op' | 'val' | 'kw' | 'punct'; s: string };

const fmtVal = (v: unknown) => (typeof v === 'number' ? String(v) : `"${String(v)}"`);
export function conditionTokens(c: Condition, fields: Map<string, FieldDef>): Tok[] {
  const f = fields.get(c.field);
  const out: Tok[] = [];
  if (c.not) out.push({ k: 'kw', s: 'NOT ' });
  out.push({ k: 'field', s: f?.label ?? (c.field || '…') });
  out.push({ k: 'op', s: ' ' + (c.operator || '…') });
  if (!NO_VALUE_OPS.has(c.operator)) {
    const v = c.value;
    if (Array.isArray(v)) {
      if (c.operator === 'between') out.push({ k: 'val', s: ` ${fmtVal(v[0] ?? '…')} and ${fmtVal(v[1] ?? '…')}` });
      else out.push({ k: 'val', s: ` [${v.map((x) => String(x)).join(', ')}]` });
    } else if (v === null || v === undefined || v === '') out.push({ k: 'val', s: ' …' });
    else out.push({ k: 'val', s: ' ' + fmtVal(v) });
  }
  return out;
}
export function treeTokens(n: Node, fields: Map<string, FieldDef>, root = true): Tok[] {
  if (n.type === 'condition') return conditionTokens(n, fields);
  const items = n.children.map((c) => ({ toks: treeTokens(c, fields, false), join: c.join ?? n.op })).filter((x) => x.toks.length);
  if (!items.length) return [];
  const out: Tok[] = [];
  const wrap = !root || n.not;
  if (n.not) out.push({ k: 'kw', s: 'NOT ' });
  if (wrap) out.push({ k: 'punct', s: '(' });
  if (items.slice(1).every((x) => x.join === n.op)) {
    items.forEach((it, i) => {
      if (i) out.push({ k: 'kw', s: ` ${n.op} ` });
      out.push(...it.toks);
    });
  } else {
    // mixed connectors: AND binds tighter than OR, so bracket each AND-run
    const runs: Tok[][][] = [[items[0].toks]];
    for (const it of items.slice(1)) (it.join === 'OR' ? runs.push([it.toks]) : runs[runs.length - 1].push(it.toks));
    runs.forEach((run, ri) => {
      if (ri) out.push({ k: 'kw', s: ' OR ' });
      if (run.length > 1) out.push({ k: 'punct', s: '(' });
      run.forEach((t, i) => {
        if (i) out.push({ k: 'kw', s: ' AND ' });
        out.push(...t);
      });
      if (run.length > 1) out.push({ k: 'punct', s: ')' });
    });
  }
  if (wrap) out.push({ k: 'punct', s: ')' });
  return out;
}
export const treeText = (n: Node, fields: Map<string, FieldDef>) => treeTokens(n, fields).map((t) => t.s).join('');

// ---------- URL hash serialization ----------
export interface HashState { tree: Group; options?: QueryOptions; summary?: SummarySpec }
const b64 = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
};
const stripIds = (n: Node): Node =>
  n.type === 'group' ? { type: 'group', op: n.op, not: n.not, children: n.children.map(stripIds), ...(n.join ? { join: n.join } : {}) } : { type: 'condition', field: n.field, operator: n.operator, value: n.value, not: n.not, ...(n.join ? { join: n.join } : {}) };

export function encodeHash(tree: Group, options?: QueryOptions, summary?: SummarySpec | null): string {
  if (!tree.children.length && !summary) return '';
  return '#q=' + b64.enc(JSON.stringify({ tree: stripIds(tree), options, summary: summary ?? undefined }));
}
export function decodeHash(hash: string): HashState | null {
  const m = /[#&]q=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    const j = JSON.parse(b64.dec(m[1]));
    if (j?.tree?.type !== 'group') return null;
    return { tree: withIds(j.tree as Group), options: j.options, summary: j.summary };
  } catch {
    return null;
  }
}

// ---------- presets ----------
const c = (logical: string, operator: string, value: any = null): Condition => lcond(logical, operator, value);
const g = (op: 'AND' | 'OR', children: Node[]): Group => ({ type: 'group', op, not: false, children });

export interface Preset { id: string; label: string; entity: Entity; description: string; tree: Group; summary?: SummarySpec }
const sm = (groupBy: SummarySpec['groupBy'], metrics: SummarySpec['metrics']): SummarySpec => ({ groupBy, metrics, sort: null, limit: 50 });
export const getPresets = (): Preset[] => [
  { id: 's-assets-bu', entity: 'assets', label: 'Assets per business unit', description: 'Summary: how many assets each business unit owns',
    tree: g('AND', []), summary: sm([{ field: L('business_unit') }], [{ fn: 'count_distinct', field: L('gold_asset_id') }]) },
  { id: 's-assets-region-class', entity: 'assets', label: 'Assets by region and class', description: 'Summary: servers vs endpoints in each region',
    tree: g('AND', []), summary: sm([{ field: L('region') }, { field: L('asset_class') }], [{ fn: 'count_distinct', field: L('gold_asset_id') }]) },
  { id: 's-vulns-severity-bu', entity: 'vulnerabilities', label: 'Open findings by severity per business unit', description: 'Summary: findings and affected assets',
    tree: g('AND', [openCond()]), summary: sm([{ field: L('business_unit') }, { field: L('severity') }], [{ fn: 'count_distinct', field: L('finding_id') }, { fn: 'count_distinct', field: L('gold_asset_id') }]) },
  { id: 's-vulns-kev-bu', entity: 'vulnerabilities', label: 'KEV findings per business unit', description: 'Summary: known exploited findings and assets',
    tree: g('AND', [c('kev_flag', 'is true'), openCond()]), summary: sm([{ field: L('business_unit') }], [{ fn: 'count_distinct', field: L('finding_id') }, { fn: 'count_distinct', field: L('gold_asset_id') }]) },
  { id: 'v-kev-exposed', entity: 'vulnerabilities', label: 'KEV & Internet-exposed', description: 'Known exploited vulnerabilities on internet-facing assets',
    tree: g('AND', [c('kev_flag', 'is true'), c('internet_exposed', 'is true')]) },
  { id: 'v-crit-high-overdue', entity: 'vulnerabilities', label: 'Critical/High overdue SLA', description: 'Critical or High findings already past their SLA due date',
    tree: g('AND', [critHighCond(), c('overdue_days', '>', 0), openCond()]) },
  { id: 'v-epss-patch', entity: 'vulnerabilities', label: 'EPSS > 0.5 with patch available', description: 'Likely to be exploited and fixable right now',
    tree: g('AND', [c('epss', '>', 0.5), c('te_plugin_has_patch', 'is true')]) },
  { id: 'v-past-sla-critical-assets', entity: 'vulnerabilities', label: 'Past SLA on critical assets', description: 'SLA breached on assets rated Critical',
    tree: g('AND', [c('sla_breached', 'is true'), c('criticality', 'is', 'Critical')]) },
  { id: 'a-exposed-critical', entity: 'assets', label: 'Internet-exposed critical assets', description: 'Critical assets reachable from the internet',
    tree: g('AND', [c('internet_exposed', 'is true'), c('criticality', 'is', 'Critical')]) },
  { id: 'a-no-agent-stale', entity: 'assets', label: 'No agent / stale > 30 days', description: 'No Tenable agent, or not seen for more than 30 days',
    tree: g('OR', [c('te_has_agent', 'is false'), c('te_has_agent', 'is empty'), c('tenable_agent_days_since_active', '>', 30), c('last_seen_age', '>', 30), c('asset_aging_status', 'is', 'Stale')]) },
  { id: 'a-eol-os', entity: 'assets', label: 'End-of-life OS', description: 'Heuristic on OS name (Windows 10 or older, Server 2012 or older); assets carry no EOL column',
    tree: g('OR', [c('os_name', 'contains', 'Windows 10'), c('os_name', 'contains', 'Windows 7'), c('os_name', 'contains', 'Windows 8'), c('os_name', 'contains', 'Server 2012'), c('os_name', 'contains', 'Server 2008')]) },
];

export const cond = (field: string, operator: string, value: any = null): Condition => ({ type: 'condition', field, operator, value, not: false });

/** A preset is offered only when every field it uses exists in this data. */
export function presetAvailable(p: Preset, fields: Map<string, FieldDef>): boolean {
  if (!fields.size) return true;
  const ok = (n: Node): boolean => (n.type === 'condition' ? fields.has(n.field) : n.children.every(ok));
  const sumFields = p.summary ? [...p.summary.groupBy.map((g) => g.field), ...p.summary.metrics.map((m) => m.field).filter((f): f is string => !!f)] : [];
  return ok(p.tree) && sumFields.every((f) => fields.has(f));
}
