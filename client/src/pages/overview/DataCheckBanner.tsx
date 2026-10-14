import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Info, TriangleAlert } from 'lucide-react';
import { Api } from '@/lib/api';

/** Mismatches between the configured business values and the actual data (and notes about missing columns). */
export function DataCheckBanner() {
  const q = useQuery({ queryKey: ['data-check'], queryFn: Api.dataCheck, staleTime: 30 * 60_000, retry: 0 });
  const [open, setOpen] = useState(false);
  if (!q.data || (!q.data.warnings.length && !q.data.info.length)) return null;
  return (
    <div className="no-print mx-auto max-w-[1800px] space-y-2 px-4 pt-4 sm:px-6">
      {q.data.warnings.map((w) => (
        <div key={w} role="alert" className="flex items-start gap-2 rounded-md border border-sev-medium/40 bg-sev-medium/10 px-3 py-2 text-xs">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-sev-medium" /> <span>{w}</span>
        </div>
      ))}
      {q.data.info.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <Info size={12} /> Data notes ({q.data.info.length})
          </button>
          {open && <ul className="mt-1 list-disc space-y-0.5 pl-9">{q.data.info.map((i) => <li key={i}>{i}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
