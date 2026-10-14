import type { Entity } from '@shared/types';
import { L } from '@shared/semantics';

export const ENTITY: Record<Entity, { label: string; singular: string; key: string; path: string; filePrefix: string; sortable: string }> = {
  assets: { label: 'Assets', singular: 'asset', get key() { return L('gold_asset_id'); }, path: '/dashboard/assets', filePrefix: 'assets', get sortable() { return L('gold_asset_id'); } },
  vulnerabilities: { label: 'Vulnerabilities', singular: 'vulnerability', get key() { return L('finding_id'); }, path: '/dashboard/vulnerabilities', filePrefix: 'vulnerabilities', get sortable() { return L('finding_id'); } },
};
