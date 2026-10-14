import type { Entity, FieldDef, FieldType } from '../shared/types';
import { OPERATORS } from '../shared/types';
import { KNOWN_COLUMNS } from './knownColumns';
import { L, semantics } from '../shared/semantics';

/**
 * Single source of truth and SQL-injection whitelist.
 * Only keys listed here may appear in WHERE clauses; SELECT/ORDER BY additionally allow
 * any column confirmed by DESCRIBE TABLE (see setLiveColumns).
 */
const ACRONYMS: Record<string, string> = {
  ip: 'IP', mac: 'MAC', id: 'ID', os: 'OS', fqdn: 'FQDN', cve: 'CVE', cvss: 'CVSS', vpr: 'VPR', epss: 'EPSS', kev: 'KEV',
  sla: 'SLA', te: 'TE', cs: 'CS', df: 'DF', voc: 'VOC', eos: 'EOS', tool: 'Tool', url: 'URL',
};
export const labelFor = (key: string) =>
  key
    .split('_')
    .map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

type Spec = [group: string, type: FieldType, keys: string, extra?: Partial<FieldDef>];

function build(specs: Spec[], defaults: string[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const [group, type, keys, extra] of specs) {
    for (const key of keys.split(/\s+/).filter(Boolean)) {
      out.push({ key, label: labelFor(key), type, group, enumFromDb: type === 'enum' ? true : undefined, defaultColumn: defaults.includes(key), ...extra });
    }
  }
  return out;
}

const ASSET_DEFAULTS = ['hostname', 'ip_address', 'gold_asset_id', 'asset_class', 'criticality', 'business_unit', 'region', 'internet_exposed', 'os_name', 'asset_aging_status', 'tool_visibility', 'last_seen'];
const VULN_DEFAULTS = ['vulnerability_name', 'severity', 'cve', 'hostname', 'criticality', 'kev_flag', 'epss', 'final_score', 'sla_status', 'overdue_days', 'te_state', 'business_unit', 'first_found'];

const ASSETS: FieldDef[] = build(
  [
    ['Identity', 'string', 'hostname fqdn ip_address mac_address serial_number asset_id gold_asset_id asset_cluster_id'],
    ['Classification', 'enum', 'asset_class device_type device_role criticality risk_level business_unit machine_group domain'],
    ['Classification', 'string', 'tags_normalized'],
    ['OS', 'string', 'os_name'],
    ['OS', 'enum', 'os_type os_distribution os_version'],
    ['OS', 'number', 'os_major_version'],
    ['OS', 'boolean', 'os_is_windows_server'],
    ['Location', 'enum', 'country region data_center'],
    ['Exposure', 'boolean', 'internet_exposed'],
    ['Exposure', 'enum', 'df_exposure_level'],
    ['Exposure', 'string', 'te_open_ports'],
    ['Lifecycle', 'enum', 'status asset_aging_status'],
    ['Lifecycle', 'date', 'first_seen last_seen snapshot_date'],
    ['Lifecycle', 'number', 'last_seen_age'],
    ['Coverage', 'string', 'tool_sources'],
    ['Coverage', 'enum', 'tool_visibility latest_reporting_tool'],
    ['Coverage', 'date', 'latest_reporting_tool_last_seen te_last_seen cs_last_seen df_last_seen'],
    ['Coverage', 'boolean', 'te_has_agent'],
    ['Coverage', 'number', 'tenable_agent_days_since_active'],
    ['CrowdStrike', 'enum', 'cs_agent_version cs_platform_name cs_system_manufacturer cs_system_product_name'],
    ['CrowdStrike', 'string', 'cs_last_login_user'],
    ['CrowdStrike', 'date', 'cs_last_reboot'],
    ['Defender', 'enum', 'df_status df_onboarding_status df_sensor_health_state df_device_category df_model df_vendor df_asset_value'],
  ],
  ASSET_DEFAULTS,
);

const VULNS: FieldDef[] = build(
  [
    ['Finding', 'string', 'vulnerability_name title finding_id vulnerability_id'],
    ['Finding', 'enum', 'severity te_state te_plugin_family'],
    ['Finding', 'number', 'plugin_id'],
    ['Finding', 'boolean', 'te_plugin_has_patch'],
    ['CVE & Threat', 'string', 'cve'],
    ['CVE & Threat', 'number', 'cvss normalized_cvss vpr_score epss latest_epss latest_epss_percentile'],
    ['CVE & Threat', 'enum', 'te_plugin_vpr_vpr_severity kev_status exploit_status df_exploitability_level'],
    ['CVE & Threat', 'boolean', 'kev_flag'],
    ['Prioritization', 'enum', 'priority_code'],
    ['Prioritization', 'number', 'priority_rank final_score criticality_score exposure_score kev_score'],
    ['SLA', 'enum', 'sla_status'],
    ['SLA', 'boolean', 'sla_breached'],
    ['SLA', 'number', 'sla_target_days overdue_days vulnerability_age_days'],
    ['SLA', 'date', 'sla_due_date'],
    ['Software', 'enum', 'software_name software_type product_name vendor'],
    ['Software', 'string', 'software_version recommended_version remediation_recommendation solution'],
    ['Asset context', 'string', 'hostname ip_address asset_id gold_asset_id'],
    ['Asset context', 'string', 'os_name'],
    ['Asset context', 'enum', 'os_family criticality asset_class device_type device_role business_unit region country data_center domain voc_assignment_group'],
    ['Asset context', 'boolean', 'internet_exposed'],
    ['Dates', 'date', 'first_found last_found first_seen last_seen te_last_fixed snapshot_date'],
    ['Source', 'string', 'tool_sources'],
    ['Source', 'enum', 'source_tool df_status df_end_of_support_status'],
    ['Source', 'date', 'df_end_of_support_date'],
  ],
  VULN_DEFAULTS,
);

export const tableName = (e: Entity) => semantics().tables[e];
/** Stable ordering keys, resolved through the column map; only columns that exist are used. */
export const tiebreakers = (e: Entity): string[] =>
  [e === 'assets' ? L('gold_asset_id') : L('finding_id'), L('snapshot_date')].filter((c) => isSelectableColumn(e, c));
/** Keys used for the detail drawer lookup. */
export const detailKey = (e: Entity) => (e === 'assets' ? L('gold_asset_id') : L('finding_id'));

const CATALOG: Record<Entity, FieldDef[]> = { assets: ASSETS, vulnerabilities: VULNS };
const BY_KEY: Record<Entity, Map<string, FieldDef>> = {
  assets: new Map(ASSETS.map((f) => [f.key, f])),
  vulnerabilities: new Map(VULNS.map((f) => [f.key, f])),
};

for (const f of [...ASSETS, ...VULNS]) f.operators = OPERATORS[f.type];

export const isEntity = (e: unknown): e is Entity => e === 'assets' || e === 'vulnerabilities';
export const getCatalog = (e: Entity) => CATALOG[e];
export const getField = (e: Entity, key: string) => BY_KEY[e].get(key);

// ---- Columns (SELECT / ORDER BY whitelist) ----
const liveColumns: Partial<Record<Entity, Set<string>>> = {};
export function setLiveColumns(e: Entity, cols: string[]) {
  liveColumns[e] = new Set(cols);
}
export const hasLiveColumns = (e: Entity) => !!liveColumns[e];
export function allColumns(e: Entity): string[] {
  return [...(liveColumns[e] ?? new Set(KNOWN_COLUMNS[e]))];
}
export function isSelectableColumn(e: Entity, key: string): boolean {
  if (typeof key !== 'string') return false;
  return (liveColumns[e] ?? new Set(KNOWN_COLUMNS[e])).has(key);
}
export function defaultColumns(e: Entity): string[] {
  return CATALOG[e].filter((f) => f.defaultColumn).map((f) => f.key);
}
/** Catalog fields + every remaining column (type unknown → string) for the column chooser. */
export function columnChoices(e: Entity): FieldDef[] {
  const inCatalog = BY_KEY[e];
  const extra = allColumns(e)
    .filter((c) => !inCatalog.has(c))
    .map<FieldDef>((c) => ({ key: c, label: labelFor(c), type: 'string', group: 'More fields…', operators: [] }));
  return [...CATALOG[e], ...extra];
}
export interface LiveColumn { name: string; dataType: string }
const liveMeta: Partial<Record<Entity, { columns: number; syncedAt: number }>> = {};
export const getSchemaInfo = (e: Entity) => liveMeta[e] ?? null;

/** Warehouse data type → builder field type (null = not filterable, e.g. arrays/structs). */
export function fieldTypeFor(dataType: string): FieldType | null {
  const t = dataType.toLowerCase();
  if (t === 'boolean') return 'boolean';
  if (t === 'string' || t.startsWith('varchar') || t.startsWith('char')) return 'string';
  if (/^(tinyint|smallint|int|integer|bigint|float|double|decimal|numeric|long|short)/.test(t)) return 'number';
  if (t === 'date' || t.startsWith('timestamp')) return 'date';
  return null;
}

/**
 * Makes the catalog follow the warehouse: curated fields keep their labels/groups/enum hints, every other
 * discovered column becomes filterable under "Other columns" using its real data type.
 */
export function applyLiveSchema(e: Entity, cols: LiveColumn[]): { added: string[]; dropped: string[]; retyped: string[] } {
  setLiveColumns(e, cols.map((c) => c.name));
  const live = new Map(cols.map((c) => [c.name, c.dataType]));
  const dropped: string[] = [];
  const retyped: string[] = [];
  // Curated fields keep their label/group, but the TYPE always comes from the warehouse so operators never mismatch the data.
  const kept: FieldDef[] = [];
  for (const f of CATALOG[e]) {
    const dt = live.get(f.key);
    const lt = dt === undefined ? null : fieldTypeFor(dt);
    if (!lt) { dropped.push(f.key); continue; }
    const type: FieldType = f.type === 'enum' && lt === 'string' ? 'enum' : lt;
    if (type !== f.type) retyped.push(`${f.key}: ${f.type} -> ${type}`);
    kept.push({ ...f, type, operators: OPERATORS[type], enumFromDb: type === 'enum' ? true : undefined });
  }
  const known = new Set(kept.map((f) => f.key));
  const added: string[] = [];
  const extra: FieldDef[] = [];
  for (const c of cols) {
    if (known.has(c.name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)) continue;
    const type = fieldTypeFor(c.dataType);
    if (!type) continue;
    added.push(c.name);
    extra.push({ key: c.name, label: labelFor(c.name), type, group: 'Other columns', operators: OPERATORS[type] });
  }
  CATALOG[e] = [...kept, ...extra];
  BY_KEY[e].clear();
  CATALOG[e].forEach((f) => BY_KEY[e].set(f.key, f));
  liveMeta[e] = { columns: cols.length, syncedAt: Date.now() };
  return { added, dropped, retyped };
}

/** Which scope columns exist on this table (drives the snapshot / validity switches). */
export const scopeAvailability = (e: Entity) => ({ snapshot: isSelectableColumn(e, L('snapshot_date')), valid: isSelectableColumn(e, L('is_valid')) });

/** Catalog fields whose column no longer exists in the live table are dropped. */
export function pruneCatalogToLive(e: Entity): string[] {
  const live = liveColumns[e];
  if (!live) return [];
  const dropped: string[] = [];
  CATALOG[e] = CATALOG[e].filter((f) => (live.has(f.key) ? true : (dropped.push(f.key), false)));
  BY_KEY[e].clear();
  CATALOG[e].forEach((f) => BY_KEY[e].set(f.key, f));
  return dropped;
}
