import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { useToasts } from '@/store/toast';
import { cn } from '@/lib/utils';

const icon = { info: Info, success: CheckCircle2, error: XCircle, warning: AlertTriangle, progress: Loader2 } as const;
const tone = { info: 'text-primary', success: 'text-ok', error: 'text-sev-critical', warning: 'text-sev-medium', progress: 'text-primary' } as const;

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2 no-print" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = icon[t.kind];
        return (
          <div key={t.id} className="glass bg-popover shadow-xl p-3 animate-pop-in">
            <div className="flex items-start gap-2.5">
              <Icon size={16} className={cn('mt-0.5 shrink-0', tone[t.kind], t.kind === 'progress' && 'animate-spin')} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t.title}</div>
                {t.description && <div className="mt-0.5 text-xs text-muted-foreground break-words">{t.description}</div>}
                {t.kind === 'progress' && t.progress !== undefined && (
                  <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary transition-all duration-200" style={{ width: `${Math.min(100, t.progress * 100)}%` }} />
                  </div>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
