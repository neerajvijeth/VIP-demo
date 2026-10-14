import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Download, History, Loader2, MessageSquarePlus, Send, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { cn, downloadText, fmtNum, timestamp } from '@/lib/utils';
import { csvRow } from '@shared/csv';
import { useChat, type ChatMessage, type GenieQuery } from '@/store/chat';

const STARTERS = ['Top 10 riskiest assets', 'How many KEV vulns are overdue?', 'Vulnerabilities by business unit', 'Which internet-exposed assets have critical vulnerabilities?'];

function ResultTable({ q }: { q: GenieQuery }) {
  const cols = q.columns ?? [];
  const rows = q.rows ?? [];
  if (!cols.length) return null;
  const download = () => downloadText(`genie_${timestamp()}.csv`, csvRow(cols.map((c) => c.name)) + rows.map((r) => csvRow(r)).join(''));
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span>{fmtNum(q.rowCount ?? rows.length)} row{(q.rowCount ?? rows.length) === 1 ? '' : 's'}{rows.length > 50 ? ' · showing first 50' : ''}{q.truncated ? ' · result truncated by Genie' : ''}</span>
        <button onClick={download} className="inline-flex items-center gap-1 text-primary hover:underline"><Download size={12} /> Download CSV{rows.length ? ` (${fmtNum(rows.length)} rows)` : ''}</button>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card"><tr>{cols.map((c) => <th key={c.name} className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-muted-foreground">{c.name}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i} className="border-t border-border/60">{r.map((v, j) => <td key={j} className="max-w-[18rem] truncate whitespace-nowrap px-3 py-1.5" title={v === null ? '' : String(v)}>{v === null || v === undefined ? <span className="text-muted-foreground/50">–</span> : String(v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} View SQL
      </button>
      {open && <pre className="mono mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-xs">{sql}</pre>}
    </div>
  );
}

function Assistant({ m, convId, onAsk }: { m: ChatMessage; convId: string; onAsk: (q: string) => void }) {
  const feedback = useChat((s) => s.feedback);
  return (
    <div>
      <div className="eyebrow mb-1.5">Genie</div>
      <div className="min-w-0 max-w-full">
        {m.pending && (
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 size={14} className="animate-spin text-primary" /> {m.status ?? 'Working…'}
          </div>
        )}
        {m.error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-sev-critical/30 bg-sev-critical/10 px-3 py-2 text-sm">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-sev-critical" /> <span>{m.error}</span>
          </div>
        )}
        {m.result && (
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            {m.result.text.map((t, i) => <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{t.content}</p>)}
            {m.result.queries.map((q, i) => (
              <div key={i} className={cn(i > 0 || m.result!.text.length ? 'mt-3 border-t border-border/60 pt-3' : '')}>
                {q.title && <div className="text-sm font-medium">{q.title}</div>}
                {q.description && <p className="text-xs text-muted-foreground">{q.description}</p>}
                {q.resultError && <p className="mt-1 text-xs text-sev-critical">Could not load results: {q.resultError}</p>}
                <ResultTable q={q} />
                {q.sql && <SqlBlock sql={q.sql} />}
              </div>
            ))}
            {!m.result.text.length && !m.result.queries.length && <p className="text-sm text-muted-foreground">Genie returned no content for this question.</p>}
          </div>
        )}
        {m.result && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button className={cn('rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground', m.feedback === 'POSITIVE' && 'text-ok')} onClick={() => feedback(convId, m.id, 'POSITIVE')} aria-label="Good answer" aria-pressed={m.feedback === 'POSITIVE'}><ThumbsUp size={14} /></button>
            <button className={cn('rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground', m.feedback === 'NEGATIVE' && 'text-sev-critical')} onClick={() => feedback(convId, m.id, 'NEGATIVE')} aria-label="Bad answer" aria-pressed={m.feedback === 'NEGATIVE'}><ThumbsDown size={14} /></button>
            {m.result.suggested.slice(0, 3).map((s) => (
              <button key={s} onClick={() => onAsk(s)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground">{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function History_({ onPick }: { onPick?: () => void }) {
  const { conversations, activeId, select, remove, newChat } = useChat();
  return (
    <div className="flex h-full flex-col">
      <div className="p-2"><Button variant="primary" className="w-full" onClick={() => { newChat(); onPick?.(); }}><MessageSquarePlus size={15} /> New chat</Button></div>
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">History</div>
      <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {conversations.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No conversations yet.</li>}
        {conversations.map((c) => (
          <li key={c.id} className={cn('group flex items-center rounded-md', c.id === activeId ? 'bg-muted' : 'hover:bg-muted/60')}>
            <button className={cn('flex-1 truncate px-2.5 py-2 text-left text-sm', c.id === activeId ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground')} onClick={() => { select(c.id); onPick?.(); }} title={c.title}>{c.title}</button>
            <button className="mr-1 hidden rounded p-1 text-muted-foreground hover:text-sev-critical group-hover:block" onClick={() => remove(c.id)} aria-label={`Delete conversation ${c.title}`}><Trash2 size={13} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ChatPage() {
  const { conversations, activeId, send, newChat } = useChat();
  const conv = conversations.find((c) => c.id === activeId);
  const cfg = useQuery({ queryKey: ['genie-config'], queryFn: () => api<{ configured: boolean }>('/api/genie/config'), staleTime: Infinity, retry: 0 });
  const [text, setText] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = !!conv?.messages.some((m) => m.pending);
  const sig = useMemo(() => conv?.messages.map((m) => `${m.id}${m.pending}${m.status}${!!m.result}`).join('|'), [conv]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [sig, activeId]);

  const submit = (q = text) => {
    if (!q.trim() || busy) return;
    setText('');
    void send(q);
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-background md:block" aria-label="Conversation history"><History_ /></aside>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen} side="left" width="max-w-xs" title="Conversations"><History_ onPick={() => setHistoryOpen(false)} /></Sheet>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Chat">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 md:hidden">
          <Button size="sm" onClick={() => setHistoryOpen(true)}><History size={14} /> History</Button>
          <Button size="sm" onClick={newChat}><MessageSquarePlus size={14} /> New chat</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-4 py-6">
            {cfg.data && !cfg.data.configured && (
              <div role="alert" className="rounded-lg border border-sev-medium/40 bg-sev-medium/10 px-3 py-2 text-sm"><b>Genie is not configured.</b> Set <span className="mono">GENIE_SPACE_ID</span> on the server (see README).</div>
            )}
            {!conv || conv.messages.length === 0 ? (
              <div className="my-auto text-center">
                <h1 className="font-display text-[40px] leading-tight">Ask about your<br />vulnerability data</h1>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Questions are answered with SQL generated by your Databricks Genie space. You can always inspect the query.</p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {STARTERS.map((s) => <button key={s} onClick={() => submit(s)} className="rounded-md border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">{s}</button>)}
                </div>
              </div>
            ) : (
              conv.messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-muted px-4 py-2.5 text-sm">{m.content}</div>
                  </div>
                ) : (
                  <Assistant key={m.id} m={m} convId={conv.id} onAsk={submit} />
                ),
              )
            )}
            <div ref={endRef} />
          </div>
        </div>

        <form className="border-t border-border bg-background px-4 py-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              rows={1}
              maxLength={4000}
              placeholder={busy ? 'Waiting for Genie…' : 'Ask a question about assets or vulnerabilities…'}
              aria-label="Message"
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-ring"
            />
            <Button type="submit" variant="primary" size="icon" disabled={!text.trim() || busy || cfg.data?.configured === false} aria-label="Send">{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</Button>
          </div>
          <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line. Answers are generated by AI — verify before acting.</p>
        </form>
      </section>
    </div>
  );
}
