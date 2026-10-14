import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';
import { uid } from '@/lib/utils';

export interface GenieQuery {
  attachmentId?: string;
  title?: string;
  description?: string;
  sql?: string;
  columns?: { name: string; type?: string }[];
  rows?: unknown[][];
  rowCount?: number;
  truncated?: boolean;
  resultError?: string;
}
export interface GenieResult {
  text: { content: string; purpose?: string }[];
  queries: GenieQuery[];
  suggested: string[];
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  pending?: boolean;
  status?: string;
  error?: string;
  result?: GenieResult;
  genieMessageId?: string;
  feedback?: 'POSITIVE' | 'NEGATIVE';
}
export interface Conversation {
  id: string;
  genieId?: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  newChat: () => void;
  select: (id: string) => void;
  remove: (id: string) => void;
  send: (text: string) => Promise<void>;
  feedback: (convId: string, msgId: string, rating: 'POSITIVE' | 'NEGATIVE') => void;
}

const sources = new Map<string, EventSource>();

export const useChat = create<ChatState>()(
  persist(
    (set, get) => {
      const patchMsg = (convId: string, msgId: string, patch: Partial<ChatMessage>) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? { ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) } : c,
          ),
        }));

      return {
        conversations: [],
        activeId: null,
        newChat: () => set({ activeId: null }),
        select: (activeId) => set({ activeId }),
        remove: (id) => {
          sources.get(id)?.close();
          sources.delete(id);
          set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id), activeId: s.activeId === id ? null : s.activeId }));
        },
        feedback: (convId, msgId, rating) => {
          const conv = get().conversations.find((c) => c.id === convId);
          const msg = conv?.messages.find((m) => m.id === msgId);
          if (!conv?.genieId || !msg?.genieMessageId) return;
          patchMsg(convId, msgId, { feedback: rating });
          void api('/api/genie/feedback', { method: 'POST', json: { conversationId: conv.genieId, messageId: msg.genieMessageId, rating } }).catch(() => undefined);
        },
        send: async (text) => {
          const content = text.trim();
          if (!content) return;
          let conv = get().conversations.find((c) => c.id === get().activeId);
          if (conv?.messages.some((m) => m.pending)) return; // one question at a time per conversation
          if (!conv) {
            conv = { id: uid(), title: content.slice(0, 60), updatedAt: Date.now(), messages: [] };
            set((s) => ({ conversations: [conv!, ...s.conversations], activeId: conv!.id }));
          }
          const convId = conv.id;
          const userMsg: ChatMessage = { id: uid(), role: 'user', content };
          const aiMsg: ChatMessage = { id: uid(), role: 'assistant', pending: true, status: 'Asking Genie…' };
          set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, userMsg, aiMsg] } : c)) }));

          try {
            const genieId = get().conversations.find((c) => c.id === convId)?.genieId;
            const r = genieId
              ? await api<{ conversationId: string; messageId: string }>('/api/genie/message', { method: 'POST', json: { conversationId: genieId, content } })
              : await api<{ conversationId: string; messageId: string }>('/api/genie/start', { method: 'POST', json: { content } });
            if (!r.conversationId || !r.messageId) throw new Error('Genie did not return a message id');
            set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? { ...c, genieId: r.conversationId } : c)) }));
            patchMsg(convId, aiMsg.id, { genieMessageId: r.messageId });

            await new Promise<void>((resolve) => {
              const es = new EventSource(`/api/genie/poll?conversationId=${encodeURIComponent(r.conversationId)}&messageId=${encodeURIComponent(r.messageId)}`);
              sources.set(convId, es);
              const finish = () => {
                es.close();
                sources.delete(convId);
                resolve();
              };
              es.addEventListener('status', (e) => patchMsg(convId, aiMsg.id, { status: JSON.parse((e as MessageEvent).data).label }));
              es.addEventListener('result', (e) => {
                patchMsg(convId, aiMsg.id, { pending: false, status: undefined, result: JSON.parse((e as MessageEvent).data) });
                finish();
              });
              es.addEventListener('error', (e) => {
                const data = (e as MessageEvent).data;
                const msg = data ? JSON.parse(data).error : 'Connection to Genie was lost.';
                patchMsg(convId, aiMsg.id, { pending: false, status: undefined, error: msg });
                finish();
              });
            });
          } catch (e: any) {
            patchMsg(convId, aiMsg.id, { pending: false, status: undefined, error: e?.message ?? 'Request failed' });
          }
        },
      };
    },
    {
      name: 'vip-chat',
      version: 1,
      // Keep localStorage small: persist at most 50 result rows per query and drop in-flight state.
      partialize: (s) => ({
        activeId: s.activeId,
        conversations: s.conversations.slice(0, 30).map((c) => ({
          ...c,
          messages: c.messages.map((m) => ({
            ...m,
            pending: false,
            status: undefined,
            error: m.pending ? 'Interrupted (page was reloaded).' : m.error,
            result: m.result ? { ...m.result, queries: m.result.queries.map((q) => ({ ...q, rows: q.rows?.slice(0, 50) })) } : undefined,
          })),
        })),
      }),
    },
  ),
);
