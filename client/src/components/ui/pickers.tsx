import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Plus, X } from 'lucide-react';
import type { FieldDef } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from './overlay';
import { cn, useDebounced } from '@/lib/utils';

const itemCls = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-muted aria-selected:text-foreground';
const inputCls = 'h-10 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground';
const headCls = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground';

const triggerCls = 'inline-flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm transition-colors hover:bg-muted focus:border-ring data-[state=open]:border-ring';

/** Typeahead picker for one value or many; options are loaded lazily and filtered server-side. */
export function ValuePicker({ multi, value, onChange, load, cacheKey, placeholder, allowCustom, className, label, prefix }: {
  multi: boolean;
  value: string[];
  onChange: (v: string[]) => void;
  load: (q: string) => Promise<string[]>;
  cacheKey: string;
  placeholder: string;
  allowCustom?: boolean;
  className?: string;
  label?: string;
  prefix?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const opts = useQuery({ queryKey: ['values', cacheKey, dq], queryFn: () => load(dq), enabled: open, staleTime: 5 * 60_000, retry: 0 });
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const toggle = (v: string) => {
    if (!multi) {
      onChange([v]);
      setOpen(false);
    } else onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  const options = opts.data ?? [];
  const typed = q.trim();
  const pasted = allowCustom && multi ? typed.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) : [];
  const addMany = (list: string[]) => {
    onChange([...value, ...list.filter((x, i) => !value.includes(x) && list.indexOf(x) === i)]);
    setQ('');
  };
  const shown = multi ? value : value.slice(0, 1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label ?? placeholder} className={cn(triggerCls, className)}>
          {prefix}
          {shown.length === 0 ? (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          ) : multi ? (
            <span className="flex min-w-0 items-center gap-1">
              {shown.slice(0, 2).map((v) => (
                <span key={v} className="max-w-[9rem] truncate rounded-sm bg-accent px-1.5 py-px text-xs text-primary">{v}</span>
              ))}
              {shown.length > 2 && <span className="text-xs text-muted-foreground">+{shown.length - 2}</span>}
            </span>
          ) : (
            <span className="truncate">{shown[0]}</span>
          )}
          <ChevronDown size={14} className="ml-auto shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <Command shouldFilter={false} className={headCls}>
          <Command.Input value={q} onValueChange={setQ} placeholder={allowCustom && multi ? 'Search, or paste a list…' : 'Search…'} className={inputCls} autoFocus />
          {multi && value.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-border p-2">
              {value.map((v) => (
                <button key={v} onClick={() => toggle(v)} className="inline-flex items-center gap-1 rounded-sm bg-accent px-1.5 py-0.5 text-xs text-primary hover:bg-accent/70" aria-label={`Remove ${v}`}>
                  {v} <X size={11} />
                </button>
              ))}
              <button onClick={() => onChange([])} className="px-1 text-xs text-muted-foreground hover:text-foreground">Clear</button>
            </div>
          )}
          <Command.List className="max-h-64 overflow-auto p-1">
            {opts.isLoading && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Loading…</div>
            )}
            {opts.isError && <div className="px-3 py-3 text-xs text-sev-critical">Could not load values.</div>}
            {!opts.isLoading && !opts.isError && options.length === 0 && !allowCustom && <div className="px-3 py-3 text-xs text-muted-foreground">No matches.</div>}
            {options.map((o) => (
              <Command.Item key={o} value={o} onSelect={() => toggle(o)} className={itemCls}>
                <Check size={14} className={cn('shrink-0', value.includes(o) ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{o}</span>
              </Command.Item>
            ))}
            {pasted.length > 1 && (
              <Command.Item value={`__many_${typed}`} onSelect={() => addMany(pasted)} className={itemCls}>
                <Plus size={14} /> Add {pasted.length} values
              </Command.Item>
            )}
            {allowCustom && pasted.length <= 1 && typed && !options.includes(typed) && !value.includes(typed) && (
              <Command.Item value={`__add_${typed}`} onSelect={() => { toggle(typed); setQ(''); }} className={itemCls}>
                <Plus size={14} /> Add “{typed}”
              </Command.Item>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Searchable, grouped field list. */
export function FieldPicker({ fields, value, onSelect, children, open: openProp, onOpenChange, triggerClassName, ariaLabel = 'Select field' }: {
  fields: FieldDef[];
  value?: string;
  onSelect: (f: FieldDef) => void;
  children?: ReactNode; // custom trigger content
  open?: boolean;
  onOpenChange?: (b: boolean) => void;
  triggerClassName?: string;
  ariaLabel?: string;
}) {
  const [inner, setInner] = useState(false);
  const open = openProp ?? inner;
  const setOpen = onOpenChange ?? setInner;
  const groups = useMemo(() => {
    const m = new Map<string, FieldDef[]>();
    for (const f of fields) (m.get(f.group) ?? m.set(f.group, []).get(f.group)!).push(f);
    return [...m.entries()];
  }, [fields]);
  const current = fields.find((f) => f.key === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} className={cn(triggerCls, 'min-w-[9rem] max-w-[14rem]', !children && !current && 'text-muted-foreground', triggerClassName)}>
          {children ?? <span className="truncate">{current?.label ?? 'Select field…'}</span>}
          {!children && <ChevronDown size={14} className="ml-auto shrink-0 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <Command className={headCls}>
          <Command.Input placeholder="Search fields…" className={inputCls} autoFocus />
          <Command.List className="max-h-80 overflow-auto p-1">
            <Command.Empty className="px-3 py-4 text-center text-xs text-muted-foreground">No field matches.</Command.Empty>
            {groups.map(([g, list]) => (
              <Command.Group key={g} heading={g}>
                {list.map((f) => (
                  <Command.Item
                    key={f.key}
                    value={`${f.label} ${f.key} ${f.group}`}
                    onSelect={() => {
                      onSelect(f);
                      setOpen(false);
                    }}
                    className={itemCls}
                  >
                    <Check size={14} className={cn('shrink-0', f.key === value ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{f.label}</span>
                    <span className="mono ml-auto truncate text-[10px] text-muted-foreground">{f.type}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
