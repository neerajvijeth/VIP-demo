export type Entity = 'assets' | 'vulnerabilities';
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  group: string;
  operators?: string[];
  enumFromDb?: boolean;
  defaultColumn?: boolean;
}

export type Operator = string;

/** `join` = how this item connects to the PREVIOUS sibling; defaults to the group's op. */
export interface Condition {
  join?: 'AND' | 'OR';
  id?: string;
  type: 'condition';
  field: string;
  operator: Operator;
  value: any;
  not: boolean;
}
export interface Group {
  join?: 'AND' | 'OR';
  id?: string;
  type: 'group';
  op: 'AND' | 'OR';
  not: boolean;
  children: Node[];
}
export type Node = Group | Condition;

export interface QueryOptions {
  latestSnapshotOnly: boolean;
  /** Retired: the "valid records only" switch was removed and this is ignored. Kept so saved queries and links still load. */
  validOnly?: boolean;
}
export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}
export interface RunRequest {
  entity: Entity;
  tree: Group;
  columns: string[];
  sort?: SortSpec | null;
  page: number; // 0-based
  pageSize: number;
  options: QueryOptions;
}

/** A user-added Overview filter on ANY column of either table (the fixed filters below exist on both tables). */
export interface ExtraFilter { id: string; entity: Entity; condition: Condition }

/** Fixed global filters of the Overview page. */
export interface GlobalFilters {
  business_unit: string[];
  region: string[];
  country: string[];
  criticality: string[];
  internet_exposed: 'all' | 'yes' | 'no';
  asset_class: string[];
  device_type: string[];
  /** filters on any other column; AND-ed with everything else */
  extra?: ExtraFilter[];
}
export const FILTER_FIELDS = ['business_unit', 'region', 'country', 'criticality', 'asset_class', 'device_type'] as const;
export const EMPTY_FILTERS: GlobalFilters = {
  business_unit: [],
  region: [],
  country: [],
  criticality: [],
  internet_exposed: 'all',
  asset_class: [],
  device_type: [],
  extra: [],
};

export const OPERATORS: Record<FieldType, string[]> = {
  string: ['is', 'is not', 'contains', 'does not contain', 'starts with', 'ends with', 'is one of', 'is none of', 'is empty', 'is not empty', 'matches regex'],
  number: ['=', '≠', '>', '≥', '<', '≤', 'between', 'is empty', 'is not empty'],
  boolean: ['is true', 'is false', 'is empty'],
  date: ['on', 'before', 'after', 'between', 'in the last N days', 'older than N days', 'is empty'],
  enum: ['is', 'is not', 'is one of', 'is none of'],
};
/** Operators that take no value. */
export const NO_VALUE_OPS = new Set(['is empty', 'is not empty', 'is true', 'is false']);
export const MULTI_OPS = new Set(['is one of', 'is none of']);
export const RANGE_OPS = new Set(['between']);

export const emptyGroup = (): Group => ({ type: 'group', op: 'AND', not: false, children: [] });

import { L } from './semantics';

// ---------- Summaries (GROUP BY) ----------
export type MetricFn = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
export type DateBucket = 'day' | 'week' | 'month';
export interface SummaryMetric { fn: MetricFn; field?: string }
export interface SummaryGroup { field: string; bucket?: DateBucket }
export interface SummarySpec {
  groupBy: SummaryGroup[];
  metrics: SummaryMetric[];
  /** alias to sort by: group_1, group_2, metric_1 … (default: first metric, descending) */
  sort?: { by: string; dir: 'asc' | 'desc' } | null;
  limit: number;
}
export const SUMMARY_LIMITS = { maxGroups: 2, maxMetrics: 4, maxRows: 1000, defaultRows: 50 };
export const emptySummary = (entity: Entity): SummarySpec => ({
  groupBy: [{ field: L('business_unit') }],
  metrics: [{ fn: 'count_distinct', field: L(entity === 'assets' ? 'gold_asset_id' : 'finding_id') }],
  sort: null,
  limit: SUMMARY_LIMITS.defaultRows,
});
