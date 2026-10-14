import { Router, type Request, type Response } from 'express';
import { bearerToken } from '../auth';
import { config } from '../config';
import { BuilderError } from '../sqlBuilder';
import { logMeta } from '../log';

export const genieRouter = Router();

const MAX_WAIT_MS = 3 * 60_000;
const POLL_MS = 1500;
const MAX_RESULT_ROWS = 5000;

class GenieError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

async function genie(req: Request, method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  if (!config.genieSpaceId) throw new GenieError('GENIE_SPACE_ID is not configured', 503);
  const token = await bearerToken(req);
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://${config.host}/api/2.0/genie/spaces/${encodeURIComponent(config.genieSpaceId)}${path}`, {
      method,
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429 && attempt < 3) {
      // Rate limited: honour Retry-After, then retry.
      const wait = Math.min(Number(r.headers.get('retry-after')) || 2 ** attempt * 2, 20);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      continue;
    }
    const text = await r.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { message: text };
    }
    if (!r.ok) throw new GenieError(json?.message || json?.error || `Genie request failed (${r.status})`, r.status === 429 ? 429 : r.status === 404 ? 404 : 502);
    return json;
  }
}

const idOk = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_\-]{1,100}$/.test(s);
const content = (s: unknown) => {
  if (typeof s !== 'string' || !s.trim()) throw new BuilderError('content is required');
  if (s.length > 4000) throw new BuilderError('Question is too long (max 4000 characters)');
  return s.trim();
};

genieRouter.get('/config', (_req, res) => res.json({ configured: !!config.genieSpaceId }));

genieRouter.post('/start', async (req, res, next) => {
  try {
    const j = await genie(req, 'POST', '/start-conversation', { content: content(req.body?.content) });
    res.json({ conversationId: j.conversation_id ?? j.conversation?.id, messageId: j.message_id ?? j.message?.id ?? j.message?.message_id });
  } catch (e) {
    next(e);
  }
});

genieRouter.post('/message', async (req, res, next) => {
  try {
    if (!idOk(req.body?.conversationId)) throw new BuilderError('conversationId is required');
    const j = await genie(req, 'POST', `/conversations/${req.body.conversationId}/messages`, { content: content(req.body?.content) });
    res.json({ conversationId: req.body.conversationId, messageId: j.message_id ?? j.id });
  } catch (e) {
    next(e);
  }
});

genieRouter.post('/feedback', async (req, res) => {
  try {
    const { conversationId, messageId, rating } = req.body ?? {};
    if (!idOk(conversationId) || !idOk(messageId) || !['POSITIVE', 'NEGATIVE', 'NONE'].includes(rating)) throw new BuilderError('Invalid feedback');
    await genie(req, 'POST', `/conversations/${conversationId}/messages/${messageId}/feedback`, { rating });
    res.json({ ok: true });
  } catch {
    res.json({ ok: false }); // feedback is best-effort (may be unavailable on some workspaces)
  }
});

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Asking Genie…',
  FETCHING_METADATA: 'Reading your data model…',
  FILTERING_CONTEXT: 'Finding relevant context…',
  ASKING_AI: 'Asking Genie…',
  PENDING_WAREHOUSE: 'Waiting for the SQL warehouse…',
  EXECUTING_QUERY: 'Executing query…',
};

async function queryResult(req: Request, cid: string, mid: string, aid: string, signal: AbortSignal) {
  let j: any;
  try {
    j = await genie(req, 'GET', `/conversations/${cid}/messages/${mid}/attachments/${aid}/query-result`, undefined, signal);
  } catch (e: any) {
    if (e?.status !== 404) throw e;
    j = await genie(req, 'GET', `/conversations/${cid}/messages/${mid}/query-result/${aid}`, undefined, signal); // legacy path
  }
  const sr = j.statement_response ?? j;
  const columns: { name: string; type?: string }[] = (sr.manifest?.schema?.columns ?? []).map((c: any) => ({ name: c.name, type: c.type_name }));
  const all: unknown[][] = sr.result?.data_array ?? [];
  return { columns, rows: all.slice(0, MAX_RESULT_ROWS), rowCount: sr.manifest?.total_row_count ?? all.length, truncated: !!sr.manifest?.truncated || all.length > MAX_RESULT_ROWS };
}

/** Server-sent events: status updates while Genie works, then the final answer. */
genieRouter.get('/poll', async (req: Request, res: Response) => {
  const { conversationId: cid, messageId: mid } = req.query;
  if (!idOk(cid) || !idOk(mid)) return void res.status(400).json({ error: 'conversationId and messageId are required' });

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  const started = Date.now();
  let last = '';
  try {
    while (!ac.signal.aborted) {
      if (Date.now() - started > MAX_WAIT_MS) throw new GenieError('Genie took longer than 3 minutes. Try a simpler question.', 504);
      const m = await genie(req, 'GET', `/conversations/${cid}/messages/${mid}`, undefined, ac.signal);
      const status: string = m.status ?? 'SUBMITTED';
      if (status !== last && STATUS_LABEL[status]) {
        last = status;
        send('status', { status, label: STATUS_LABEL[status] ?? status });
      }
      if (status === 'FAILED') throw new GenieError(m.error?.error || 'Genie could not answer this question.', 502);
      if (status === 'CANCELLED') throw new GenieError('The request was cancelled.', 499);
      if (status === 'QUERY_RESULT_EXPIRED') throw new GenieError('The query result expired. Ask the question again.', 410);
      if (status === 'COMPLETED') {
        const attachments: any[] = m.attachments ?? [];
        const out: any = { messageId: mid, conversationId: cid, text: [], queries: [], suggested: [] };
        for (const at of attachments) {
          if (at.text?.content) out.text.push({ content: at.text.content, purpose: at.text.purpose });
          if (at.suggested_questions?.questions) out.suggested.push(...at.suggested_questions.questions);
          if (at.query) {
            const q: any = { attachmentId: at.attachment_id, title: at.query.title, description: at.query.description, sql: at.query.query };
            try {
              send('status', { status: 'EXECUTING_QUERY', label: 'Fetching results…' });
              Object.assign(q, await queryResult(req, cid, mid, at.attachment_id, ac.signal));
            } catch (e: any) {
              q.resultError = e?.message ?? 'Could not load query results';
            }
            out.queries.push(q);
          }
        }
        if (!out.text.length && m.content && !out.queries.length) out.text.push({ content: m.content });
        send('result', out);
        break;
      }
      await new Promise((ok) => setTimeout(ok, POLL_MS));
    }
  } catch (e: any) {
    if (!ac.signal.aborted) send('error', { error: e?.message ?? 'Genie request failed', status: e?.status ?? 500 });
  }
  logMeta(res, { genieMs: Date.now() - started });
  res.end();
});
