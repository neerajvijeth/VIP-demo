import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useEffect, useState } from 'react';

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: digits });
export const fmtCompact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const fmtPct = (n: number, digits = 1) => `${n.toLocaleString('en-US', { maximumFractionDigits: digits })}%`;
export const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
export const titleize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Triggers a browser download of text content (used for small client-side CSV / JSON). */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
