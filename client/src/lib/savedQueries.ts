import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface SavedSql { id: string; name: string; description: string; owner: string; visibility: 'private' | 'team'; sql: string; version: number; created_at: string; updated_at: string }
export const SavedApi = {
  me: () => api<{ user: string }>('/api/saved/me').then((r) => r.user),
  list: () => api<{ queries: SavedSql[] }>('/api/saved').then((r) => r.queries),
  create: (b: { name: string; description?: string; visibility?: string; sql: string }) => api<SavedSql>('/api/saved', { method: 'POST', json: b }),
  update: (id: string, b: Partial<Pick<SavedSql, 'name' | 'description' | 'visibility' | 'sql'>>) => api<SavedSql>(`/api/saved/${id}`, { method: 'PUT', json: b }),
  remove: (id: string) => api<{ ok: true }>(`/api/saved/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) => api<SavedSql>(`/api/saved/${id}/duplicate`, { method: 'POST', json: {} }),
  versions: (id: string) => api<{ versions: { version: number; updated_at: string }[] }>(`/api/saved/${id}/versions`).then((r) => r.versions),
  rollback: (id: string, version: number) => api<SavedSql>(`/api/saved/${id}/rollback`, { method: 'POST', json: { version } }),
};
export const useSavedSql = () => useQuery({ queryKey: ['saved-sql'], queryFn: SavedApi.list, staleTime: 30_000, retry: false });
export const useMe = () => useQuery({ queryKey: ['saved-me'], queryFn: SavedApi.me, staleTime: Infinity, retry: false });
