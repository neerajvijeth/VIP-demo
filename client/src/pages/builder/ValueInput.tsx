import type { Entity, FieldDef } from '@shared/types';
import { MULTI_OPS, NO_VALUE_OPS } from '@shared/types';
import { Input } from '@/components/ui/primitives';
import { ValuePicker } from '@/components/ui/pickers';
import { Api } from '@/lib/api';

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === null || v === undefined || v === '' ? [] : [String(v)]);

export function ValueInput({ entity, field, operator, value, onChange, onPatch }: { entity: Entity; field: FieldDef; operator: string; value: any; onChange: (v: any) => void; onPatch: (p: { operator?: string; value: any }) => void }) {
  if (NO_VALUE_OPS.has(operator)) return <span className="px-2 text-xs text-muted-foreground">no value needed</span>;
  const load = (q: string) => Api.values(entity, field.key, q);
  const cacheKey = `${entity}:${field.key}`;

  if (MULTI_OPS.has(operator)) {
    return (
      <ValuePicker multi allowCustom={field.type === 'string'} value={asArray(value)} onChange={onChange} load={load} cacheKey={cacheKey} placeholder="Select values…" label={`${field.label} values`} className="min-w-[12rem] max-w-[24rem]" />
    );
  }
  if (field.type === 'enum' || (field.type === 'string' && (operator === 'is' || operator === 'is not'))) {
    // "is" / "is not" accept several values: a second pick quietly becomes "is one of" / "is none of".
    const many = operator === 'is' ? 'is one of' : 'is none of';
    return (
      <ValuePicker
        multi
        value={asArray(value)}
        onChange={(v) => (v.length > 1 ? onPatch({ operator: many, value: v }) : onChange(v[0] ?? null))}
        load={load}
        cacheKey={cacheKey}
        placeholder="Select one or more values…"
        allowCustom={field.type === 'string'}
        label={`${field.label} value`}
        className="min-w-[12rem] max-w-[24rem]"
      />
    );
  }
  if (field.type === 'number') {
    const parse = (s: string) => (s === '' ? '' : Number(s));
    if (operator === 'between') {
      const [a, b] = Array.isArray(value) ? value : ['', ''];
      return (
        <div className="flex items-center gap-1.5">
          <Input type="number" step="any" aria-label="From" className="w-28" value={a ?? ''} onChange={(e) => onChange([parse(e.target.value), b ?? ''])} />
          <span className="text-xs text-muted-foreground">and</span>
          <Input type="number" step="any" aria-label="To" className="w-28" value={b ?? ''} onChange={(e) => onChange([a ?? '', parse(e.target.value)])} />
        </div>
      );
    }
    return <Input type="number" step="any" aria-label="Value" className="w-32" value={value ?? ''} onChange={(e) => onChange(parse(e.target.value))} />;
  }
  if (field.type === 'date') {
    if (operator === 'in the last N days' || operator === 'older than N days') {
      return (
        <div className="flex items-center gap-1.5">
          <Input type="number" min={0} max={36500} step={1} aria-label="Number of days" className="w-24" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
      );
    }
    if (operator === 'between') {
      const [a, b] = Array.isArray(value) ? value : ['', ''];
      return (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="From date" className="w-40" value={a ?? ''} onChange={(e) => onChange([e.target.value, b ?? ''])} />
          <span className="text-xs text-muted-foreground">and</span>
          <Input type="date" aria-label="To date" className="w-40" value={b ?? ''} onChange={(e) => onChange([a ?? '', e.target.value])} />
        </div>
      );
    }
    return <Input type="date" aria-label="Date" className="w-40" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return <Input aria-label="Value" className="min-w-[12rem] max-w-[22rem]" maxLength={500} placeholder={operator === 'matches regex' ? 'Regular expression' : 'Value'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}
