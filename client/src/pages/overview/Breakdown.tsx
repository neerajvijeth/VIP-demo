import { cn, fmtNum } from '@/lib/utils';
import type { Row } from './data';
import { WidgetCard, num } from './widgets';

interface Merged { label: string; assets: number; findings: number; critHigh: number; kev: number }

/** Assets and open findings per business unit / region. Both columns add up to the headline numbers for the same filters. */
export function BreakdownCard({ title, groupLabel, subtitle, assetsId, findingsId, className, onRow }: {
  title: string;
  groupLabel: string;
  subtitle: string;
  assetsId: string;
  findingsId: string;
  className?: string;
  onRow: (label: string, known: string[]) => void;
}) {
  return (
    <WidgetCard ids={[assetsId, findingsId]} title={title} subtitle={subtitle} className={className}>
      {(r) => {
        const map = new Map<string, Merged>();
        const row = (label: string) => map.get(label) ?? map.set(label, { label, assets: 0, findings: 0, critHigh: 0, kev: 0 }).get(label)!;
        for (const x of r[assetsId] as Row[]) row(String(x.label)).assets = num(x.value);
        for (const x of r[findingsId] as Row[]) { const m = row(String(x.label)); m.findings = num(x.findings); m.critHigh = num(x.crit_high); m.kev = num(x.kev); }
        // Unknown always last so the real groups lead
        const rows = [...map.values()].sort((a, b) => Number(a.label === 'Unknown') - Number(b.label === 'Unknown') || b.findings - a.findings || b.assets - a.assets);
        if (!rows.length) return <p className="py-8 text-center text-xs text-muted-foreground">No matching records for the current filters.</p>;
        const tot = rows.reduce((t, x) => ({ assets: t.assets + x.assets, findings: t.findings + x.findings, critHigh: t.critHigh + x.critHigh, kev: t.kev + x.kev }), { assets: 0, findings: 0, critHigh: 0, kev: 0 });
        const max = Math.max(1, ...rows.map((x) => x.findings));
        const known = rows.map((x) => x.label).filter((l) => l !== 'Unknown');
        const th = 'px-2 pb-1.5 text-right font-medium text-muted-foreground';
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr><th className="pb-1.5 pr-2 text-left font-medium text-muted-foreground">{groupLabel}</th><th className={th}>Assets</th><th className={cn(th, 'w-[32%] !text-left')}>Open findings</th><th className={th} title="Open findings with scanner severity Critical or High">Crit+High</th><th className={th}>KEV</th><th className={th} title="Open findings per asset">Per asset</th></tr></thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.label} tabIndex={0} onClick={() => onRow(x.label, known)} onKeyDown={(e) => e.key === 'Enter' && onRow(x.label, known)} className="cursor-pointer border-t border-border/60 hover:bg-muted/60">
                    <td className={cn('max-w-[10rem] truncate py-1.5 pr-2', x.label === 'Unknown' && 'text-muted-foreground')} title={x.label}>{x.label}</td>
                    <td className="num px-2 text-right">{fmtNum(x.assets)}</td>
                    <td className="px-2">
                      <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary/70" style={{ width: `${(x.findings / max) * 100}%` }} /></div><span className={cn('num w-9 text-right font-medium', x.findings === 0 && 'text-muted-foreground')}>{fmtNum(x.findings)}</span></div>
                    </td>
                    <td className={cn('num px-2 text-right', x.critHigh === 0 && 'text-muted-foreground')}>{fmtNum(x.critHigh)}</td>
                    <td className={cn('num px-2 text-right', x.kev === 0 && 'text-muted-foreground')}>{fmtNum(x.kev)}</td>
                    <td className="num px-2 text-right text-muted-foreground">{x.assets ? (x.findings / x.assets).toFixed(1) : '–'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-border font-medium"><td className="py-1.5 pr-2">Total</td><td className="num px-2 text-right">{fmtNum(tot.assets)}</td><td className="num px-2 text-right">{fmtNum(tot.findings)}</td><td className="num px-2 text-right">{fmtNum(tot.critHigh)}</td><td className="num px-2 text-right">{fmtNum(tot.kev)}</td><td className="num px-2 text-right text-muted-foreground">{tot.assets ? (tot.findings / tot.assets).toFixed(1) : '–'}</td></tr></tfoot>
            </table>
          </div>
        );
      }}
    </WidgetCard>
  );
}
