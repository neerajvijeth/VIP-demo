import { cn } from '@/lib/utils';

export type SevKey = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEV_COLORS: Record<SevKey, string> = {
  critical: 'hsl(var(--sev-critical))',
  high: 'hsl(var(--sev-high))',
  medium: 'hsl(var(--sev-medium))',
  low: 'hsl(var(--sev-low))',
  info: 'hsl(var(--sev-info))',
};
const SEV_CLASS: Record<SevKey, string> = {
  critical: 'bg-sev-critical/12 text-sev-critical',
  high: 'bg-sev-high/12 text-sev-high',
  medium: 'bg-sev-medium/14 text-sev-medium',
  low: 'bg-sev-low/12 text-sev-low',
  info: 'bg-sev-info/12 text-sev-info',
};
export const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'];

/** Maps common values (severity, criticality, SLA states, priorities…) to a colour tone. */
export function toneOf(value: unknown): SevKey | 'ok' | null {
  const v = String(value ?? '').toLowerCase();
  if (!v) return null;
  if (/^(critical|p1|breached|eos$|stale|none \(0\/3\)|exploited in the wild|known exploited)/.test(v)) return 'critical';
  if (/^(high|p2|due soon|upcoming eos|aging|resurfaced)/.test(v)) return 'high';
  if (/^(medium|p3|partial|new$)/.test(v)) return 'medium';
  if (/^(low|p4)/.test(v)) return 'low';
  if (/^(within sla|supported|full|active|closed|fixed|onboarded)/.test(v)) return 'ok';
  if (/^(info|p5|unknown|single)/.test(v)) return 'info';
  return null;
}

export function Badge({ tone, children, className, title }: { tone?: SevKey | 'neutral' | 'primary' | 'ok'; children: React.ReactNode; className?: string; title?: string }) {
  const cls = tone && tone !== 'neutral' && tone !== 'primary' && tone !== 'ok' ? SEV_CLASS[tone] : tone === 'primary' ? 'bg-accent text-primary' : tone === 'ok' ? 'bg-ok/12 text-ok' : 'bg-muted text-muted-foreground';
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px text-[11px] font-medium leading-5 whitespace-nowrap', cls, className)}>
      {children}
    </span>
  );
}

export const SeverityDot = ({ sev }: { sev: SevKey }) => <span className="inline-block h-2 w-2 rounded-full" style={{ background: SEV_COLORS[sev] }} />;
export const sevKey = (label: string): SevKey => (['critical', 'high', 'medium', 'low'].includes(label.toLowerCase()) ? (label.toLowerCase() as SevKey) : 'info');
