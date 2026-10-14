import 'dotenv/config';
import type { Entity } from '../shared/types';
import { semantics } from '../shared/semantics';
import { loadSemantics } from './semantics';

loadSemantics();

const ident = (v: string, name: string) => {
  if (!/^[A-Za-z0-9_\-]+$/.test(v)) throw new Error(`Invalid ${name}: ${v}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 8000),
  host: (process.env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  warehouseId: process.env.DATABRICKS_WAREHOUSE_ID || '',
  catalog: process.env.DATABRICKS_CATALOG || 'main',
  schema: process.env.DATABRICKS_SCHEMA || 'default',
  token: process.env.DATABRICKS_TOKEN || '',
  /** Local dev: take short-lived OAuth tokens from `databricks auth token --profile <name>`. */
  profile: process.env.DATABRICKS_CONFIG_PROFILE || '',
  clientId: process.env.DATABRICKS_CLIENT_ID || '',
  clientSecret: process.env.DATABRICKS_CLIENT_SECRET || '',
  useObo: process.env.USE_OBO === 'true',
  genieSpaceId: process.env.GENIE_SPACE_ID || '',
  statementTimeoutSec: Number(process.env.STATEMENT_TIMEOUT_SECONDS || 120),
  exportMaxRows: Number(process.env.EXPORT_MAX_ROWS || 1_000_000),
  cacheTtlMs: Math.max(0, Number(process.env.CACHE_TTL_SECONDS ?? 300)) * 1000,
  env: process.env.NODE_ENV === 'production' || process.env.DATABRICKS_APP_NAME ? 'Databricks App' : 'Local dev',
};

export const tableRef = (name: string) =>
  `\`${ident(config.catalog, 'DATABRICKS_CATALOG')}\`.\`${ident(config.schema, 'DATABRICKS_SCHEMA')}\`.\`${name}\``;
export const entityTable = (e: Entity) => tableRef(semantics().tables[e]);
export const kpiTable = () => tableRef(semantics().tables.kpi);
