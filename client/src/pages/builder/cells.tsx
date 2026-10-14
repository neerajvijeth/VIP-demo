import { Badge, toneOf } from '@/components/ui/badges';
import { fmtNum } from '@/lib/utils';

const TONE_KEYS = new Set(['severity', 'criticality', 'risk_level', 'priority_code', 'sla_status', 'te_state', 'kev_status', 'exploit_status', 'te_plugin_vpr_vpr_severity', 'df_exposure_level', 'asset_aging_status', 'tool_visibility', 'df_end_of_support_status', 'df_exploitability_level', 'df_asset_value', 'status', 'df_status', 'df_sensor_health_state']);
const SCORE_MAX: Record<string, number> = { final_score: 100, cvss: 10, vpr_score: 10, epss: 1, latest_epss: 1, latest_epss_percentile: 1, normalized_cvss: 1, criticality_score: 1, exposure_score: 1, kev_score: 1 };
const MONO_KEYS = new Set(['hostname', 'fqdn', 'ip_address', 'mac_address', 'serial_number', 'asset_id', 'gold_asset_id', 'asset_cluster_id', 'finding_id', 'vulnerability_id', 'cve', 'plugin_id', 'te_open_ports']);

export function ScoreBar({ value, max, fmt }: { value: number; max: number; fmt?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const hue = pct > 75 ? 'var(--sev-critical)' : pct > 50 ? 'var(--sev-high)' : pct > 25 ? 'var(--sev-medium)' : 'var(--sev-low)';
  return (
    <div className="flex w-full items-center gap-2">
      <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded bg-muted"><div className="h-full rounded" style={{ width: `${pct}%`, background: `hsl(${hue})` }} /></div>
      <span className="num text-xs">{fmt ?? fmtNum(value, 2)}</span>
    </div>
  );
}

export function fmtDate(v: string) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 16).replace('T', ' ');
  return v;
}

export function renderCell(key: string, value: unknown, type?: string) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground/60">–</span>;
  if (typeof value === 'boolean') {
    if (key === 'kev_flag') return value ? <Badge tone="critical" className="font-semibold tracking-wide">KEV</Badge> : <span className="text-muted-foreground/60">–</span>;
    if (key === 'sla_breached') return value ? <Badge tone="critical">Breached</Badge> : <Badge tone="ok">On track</Badge>;
    if (key === 'internet_exposed') return value ? <Badge tone="high">Exposed</Badge> : <Badge tone="neutral">Internal</Badge>;
    return value ? <Badge tone="ok">Yes</Badge> : <Badge tone="neutral">No</Badge>;
  }
  if (key in SCORE_MAX && (typeof value === 'number' || !Number.isNaN(Number(value)))) return <ScoreBar value={Number(value)} max={SCORE_MAX[key]} />;
  if (TONE_KEYS.has(key)) {
    const t = toneOf(value);
    return <Badge tone={t ?? 'neutral'}>{String(value)}</Badge>;
  }
  if (typeof value === 'number') return <span className="num">{fmtNum(value, 2)}</span>;
  if (typeof value === 'object') return <span className="mono text-xs">{JSON.stringify(value)}</span>;
  const s = String(value);
  if (type === 'date' || /^\d{4}-\d{2}-\d{2}T\d{2}:/.test(s)) return <span className="num">{fmtDate(s)}</span>;
  if (MONO_KEYS.has(key)) return <span className="mono text-[12px]">{s}</span>;
  return <span>{s}</span>;
}
