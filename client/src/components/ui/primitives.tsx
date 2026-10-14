import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md' | 'icon' | 'iconSm';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-muted text-foreground hover:bg-muted/70',
  ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted',
  outline: 'border border-border bg-card hover:bg-muted text-foreground',
  danger: 'bg-sev-critical/10 text-sev-critical hover:bg-sev-critical/20',
};
const sizes: Record<Size, string> = { sm: 'h-8 px-2.5 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', icon: 'h-9 w-9', iconSm: 'h-7 w-7' };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  ({ className, variant = 'outline', size = 'md', type = 'button', ...p }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn('inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none select-none', variants[variant], sizes[size], className)}
      {...p}
    />
  ),
);
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn('h-9 w-full rounded-md border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/70 transition-colors focus:border-ring', className)} {...p} />
));
Input.displayName = 'Input';

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn('h-9 rounded-md border border-border bg-card px-2 text-sm focus:border-ring cursor-pointer', className)} {...p} />
));
NativeSelect.displayName = 'NativeSelect';

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton', className)} aria-hidden />;

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="mono rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{children}</kbd>
);

export function Switch({ checked, onChange, label, title, disabled }: { checked: boolean; onChange: (b: boolean) => void; label: string; title?: string; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-xs text-muted-foreground select-none', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')} title={disabled ? 'This table has no such column, so the switch does not apply' : title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked && !disabled}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 rounded-full transition-colors duration-150', checked ? 'bg-primary' : 'bg-border')}
      >
        <span className={cn('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150', checked && 'translate-x-4')} />
      </button>
      {label}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md', ariaLabel }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex rounded-md bg-muted p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('rounded-[5px] font-medium transition-all duration-150', size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs', value === o.value ? 'bg-card text-foreground shadow-[0_0_0_1px_hsl(var(--border))]' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass', className)} {...p}>
      {children}
    </div>
  );
}

export function ErrorPanel({ message, detail, onRetry }: { message: string; detail?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-sev-critical/30 bg-sev-critical/10 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sev-critical">Something went wrong</span>
        {onRetry && (
          <button onClick={onRetry} className="text-primary hover:underline">
            Retry
          </button>
        )}
      </div>
      <details className="mt-1 text-muted-foreground">
        <summary className="cursor-pointer select-none">Show details</summary>
        <pre className="mono mt-1 whitespace-pre-wrap break-words max-h-40 overflow-auto">{detail ?? message}</pre>
      </details>
    </div>
  );
}
