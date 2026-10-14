import type { RunRequest } from '@shared/types';
import type { SummaryRequest } from './api';
import { toast, useToasts } from '@/store/toast';
import { timestamp } from './utils';

type ExportBody = Pick<RunRequest, 'entity' | 'tree' | 'columns' | 'sort' | 'options'> | SummaryRequest | { sql: string };

/**
 * Streams the full result set to disk. Chromium: File System Access API (constant memory, real progress).
 * Elsewhere: a native form download (the browser streams the response itself, no progress).
 */
export async function exportCsv(body: ExportBody, total: number, cap: number, opts: { url?: string; prefix?: string } = {}) {
  const url = opts.url ?? '/api/query/export';
  const filename = `${opts.prefix ?? (body as { entity: string }).entity}_${timestamp()}.csv`;
  const capped = total > cap;
  if (capped) toast.warning('Export will be truncated', `${total.toLocaleString()} rows match; the export is capped at ${cap.toLocaleString()} rows.`);
  const want = Math.min(total, cap);

  const picker = (window as any).showSaveFilePicker as undefined | ((o: unknown) => Promise<any>);
  let handle: any;
  if (picker) {
    try {
      handle = await picker({ suggestedName: filename, types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }] });
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // user cancelled the save dialog
      handle = undefined; // picker blocked (iframe / permissions) → use the native download below
    }
  }
  if (!handle) {
    const frame = document.createElement('iframe');
    frame.name = 'vip-export-frame';
    frame.style.display = 'none';
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = frame.name;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(body);
    form.appendChild(input);
    document.body.append(frame, form);
    form.submit();
    setTimeout(() => (form.remove(), frame.remove()), 120_000);
    toast.info('Download started', `${filename} is streaming to your browser's downloads.`);
    return;
  }

  const id = useToasts.getState().push({ kind: 'progress', title: `Exporting ${filename}`, description: `0 / ${want.toLocaleString()} rows`, progress: 0 });
  const writable = await handle.createWritable();
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) {
      let msg = `Export failed (${res.status})`;
      try { msg = (await res.json()).error ?? msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    let lines = 0;
    let lastPaint = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      for (let i = 0; i < value.length; i++) if (value[i] === 10) lines++;
      const now = performance.now();
      if (now - lastPaint > 150) {
        lastPaint = now;
        const rows = Math.max(0, lines - 1);
        useToasts.getState().update(id, { description: want ? `${rows.toLocaleString()} / ${want.toLocaleString()} rows` : `${rows.toLocaleString()} rows`, progress: want ? rows / want : undefined });
      }
    }
    await writable.close();
    useToasts.getState().update(id, { kind: 'success', title: 'Export complete', description: `${filename} · ${Math.max(0, lines - 1).toLocaleString()} rows${capped ? ' (truncated at cap)' : ''}`, progress: 1 }, 7000);
  } catch (e: any) {
    try { await writable.abort(); } catch { /* already closed */ }
    useToasts.getState().update(id, { kind: 'error', title: 'Export failed', description: e?.message ?? 'Unknown error' }, 10000);
  }
}
