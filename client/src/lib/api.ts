import type { Entity, FieldDef, GlobalFilters, Group, QueryOptions, RunRequest, SummarySpec } from '@shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public detail?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(body.error || `Request failed (${res.status})`, res.status, body.detail);
  }
  return res.json();
}

export interface SummaryRequest {
  mode: 'summary';
  entity: Entity;
  tree: Group;
  options: QueryOptions;
  summary: SummarySpec;
}
export interface RunResponse {
  columns: string[];
  labels?: string[];
  rows: Record<string, any>[];
  total: number;
  sql: string;
  params: Record<string, any>;
  elapsedMs: number;
}
export interface FieldsResponse {
  entity: Entity;
  fields: FieldDef[];
  columns: FieldDef[];
  defaultColumns: string[];
  schema: { columns: number; syncedAt: number } | null;
  scope: { snapshot: boolean; valid: boolean };
}
export type WidgetResult = { rows: Record<string, any>[]; elapsedMs: number; ignoredFilters?: string[] } | { error: string } | { unavailable: string };

/** Set by the manual Refresh button so the next Overview fetches bypass the server's result cache. */
export const freshFlag = { on: false };

export const Api = {
  fields: (entity: Entity) => api<FieldsResponse>(`/api/meta/fields?entity=${entity}`),
  values: (entity: Entity, field: string, q: string) =>
    api<{ values: string[] }>(`/api/meta/values?entity=${entity}&field=${encodeURIComponent(field)}&q=${encodeURIComponent(q)}`).then((r) => r.values),
  refreshSchema: () => api<{ ok: boolean }>('/api/meta/refresh-schema', { method: 'POST' }),
  refreshed: () => api<{ assets: string | null; vulnerabilities: string | null }>(`/api/meta/refreshed${freshFlag.on ? '?fresh=1' : ''}`),
  run: (req: RunRequest, signal?: AbortSignal) => api<RunResponse>('/api/query/run', { method: 'POST', json: req, signal }),
  count: (entity: Entity, tree: Group, options: QueryOptions, signal?: AbortSignal) =>
    api<{ total: number }>('/api/query/count', { method: 'POST', json: { entity, tree, options }, signal }),
  summaryRun: (req: SummaryRequest, signal?: AbortSignal) => api<RunResponse>('/api/query/run', { method: 'POST', json: req, signal }),
  preview: (req: Partial<RunRequest> | SummaryRequest) => api<{ sql: string; params: Record<string, any> }>('/api/query/preview', { method: 'POST', json: req }),
  detail: (entity: Entity, key: string, snapshot?: string) =>
    api<{ row: Record<string, any> }>(`/api/query/detail?entity=${entity}&key=${encodeURIComponent(key)}${snapshot ? `&snapshot=${encodeURIComponent(snapshot)}` : ''}`),
  widgets: (widgets: string[], filters: GlobalFilters, options: QueryOptions, signal?: AbortSignal) =>
    api<Record<string, WidgetResult>>('/api/overview/widgets', { method: 'POST', json: { widgets, filters, options, fresh: freshFlag.on }, signal }),
  kpis: () => api<{ metrics: Record<string, { date: string; value: number | null; suspect?: boolean }[]>; suspectDates?: string[]; skippedRuns?: number }>(`/api/kpis${freshFlag.on ? '?fresh=1' : ''}`),
  dataCheck: () => api<{ warnings: string[]; info: string[] }>('/api/meta/data-check'),
  env: () => api<{ env: string; exportMaxRows: number; catalog: string; schema: string }>('/api/env'),
  customRun: (sql: string, maxRows: number, signal?: AbortSignal) =>
    api<{ columns: string[]; rows: Record<string, any>[]; truncated: boolean; maxRows: number; elapsedMs: number }>('/api/custom/run', { method: 'POST', json: { sql, maxRows }, signal }),
};
