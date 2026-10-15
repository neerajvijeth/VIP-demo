import { api } from './api';

export type ChartType = 'bar' | 'hbar' | 'stacked' | 'line' | 'area' | 'donut' | 'table' | 'kpi';
export type Agg = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
export interface Chart { type: ChartType; dimension?: string; split?: string; measure: { agg: Agg; column?: string }; top_n?: number | null; other?: boolean; sort?: 'value_desc' | 'value_asc' | 'label_asc' | 'label_desc' }
export interface Tile { id: string; query_id: string; query_version: 'latest' | number; title: string; chart: Chart; w: number; h: number }
export interface Canvas { id: string; name: string; owner: string; visibility: 'private' | 'team'; tiles: Tile[]; created_at: string; updated_at: string }
export interface Col { name: string; type: string; numeric?: boolean }
export interface TileData {
  state: 'ok' | 'error' | 'no_access';
  message?: string;
  query?: { id: string; name: string; version: number };
  columns?: Col[];
  rows?: Array<Record<string, any> & { label: string; label2?: string; value: number | null }>;
  sql?: string; total?: number; capped?: boolean; elapsedMs?: number;
}

export const CHART_TYPES: Array<{ value: ChartType; label: string; needs: 'none' | 'one' | 'two' }> = [
  { value: 'bar', label: 'Bar (vertical)', needs: 'one' }, { value: 'hbar', label: 'Bar (horizontal)', needs: 'one' }, { value: 'stacked', label: 'Stacked bar', needs: 'two' },
  { value: 'line', label: 'Line', needs: 'one' }, { value: 'area', label: 'Area', needs: 'one' }, { value: 'donut', label: 'Donut', needs: 'one' },
  { value: 'kpi', label: 'Single number', needs: 'none' }, { value: 'table', label: 'Table', needs: 'none' },
];

export const CanvasApi = {
  list: () => api<{ canvases: Canvas[] }>('/api/canvas').then((r) => r.canvases),
  get: (id: string) => api<Canvas>(`/api/canvas/${id}`),
  create: (b: Partial<Canvas>) => api<Canvas>('/api/canvas', { method: 'POST', json: b }),
  update: (id: string, b: Partial<Canvas>) => api<Canvas>(`/api/canvas/${id}`, { method: 'PUT', json: b }),
  remove: (id: string) => api<{ ok: true }>(`/api/canvas/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) => api<Canvas>(`/api/canvas/${id}/duplicate`, { method: 'POST', json: {} }),
  columns: (queryId: string, version: 'latest' | number) => api<{ query: { id: string; name: string; version: number }; columns: Col[] }>(`/api/canvas/columns/${queryId}?version=${version}`),
  tile: (b: { query_id: string; query_version: 'latest' | number; chart: Chart }, signal?: AbortSignal) => api<TileData>('/api/canvas/tile', { method: 'POST', json: b, signal }),
};
