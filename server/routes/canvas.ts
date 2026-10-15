import { Router, type Request, type Response } from 'express';
import * as C from '../canvas';
import { BuilderError } from '../sqlBuilder';
import { getVersion, userOf } from '../savedQueries';
import { resolve } from '../savedResolve';
import { userToken } from '../auth';

export const canvasRouter = Router();
const h = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: (e?: unknown) => void) => Promise.resolve(fn(req, res)).catch(next);
const u = (req: Request) => userOf(req);
const id = (req: Request) => String(req.params.id);
const abortable = (res: Response) => { const ac = new AbortController(); res.on('close', () => !res.writableEnded && ac.abort()); return ac.signal; };

canvasRouter.get('/', (req, res) => res.json({ canvases: C.list(u(req)) }));
canvasRouter.post('/', h(async (req, res) => res.status(201).json(await C.create(req.body, u(req)))));

/** Columns (with types) of a saved query, for the chart builder. */
canvasRouter.get('/columns/:queryId', h(async (req, res) => {
  const version = req.query.version && req.query.version !== 'latest' ? Number(req.query.version) : undefined;
  const q = getVersion(String(req.params.queryId), u(req), version);
  const columns = await C.columnsOf(resolve(q), userToken(req), abortable(res));
  res.json({ query: { id: q.id, name: q.name, version: q.version }, columns: columns.map((c) => ({ ...c, numeric: C.isNumeric(c.type) })) });
}));

/** One tile's data. Also used for the live preview while building (body carries the unsaved chart). */
canvasRouter.post('/tile', h(async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.query_id !== 'string') throw new BuilderError('query_id is required');
  const version = b.query_version === 'latest' || b.query_version === undefined ? 'latest' : Number(b.query_version);
  res.json(await C.runTile({ query_id: b.query_id, query_version: version, chart: b.chart }, u(req), userToken(req), abortable(res)));
}));

canvasRouter.get('/:id', h((req, res) => res.json(C.get(id(req), u(req)))));
canvasRouter.put('/:id', h(async (req, res) => res.json(await C.update(id(req), req.body, u(req)))));
canvasRouter.delete('/:id', h(async (req, res) => { await C.remove(id(req), u(req)); res.json({ ok: true }); }));
canvasRouter.post('/:id/duplicate', h(async (req, res) => res.status(201).json(await C.duplicate(id(req), u(req)))));
