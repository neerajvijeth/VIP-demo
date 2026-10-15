import { Router, type Request, type Response } from 'express';
import * as S from '../savedQueries';

export const savedRouter = Router();
const h = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: (e?: unknown) => void) => Promise.resolve(fn(req, res)).catch(next);
const u = (req: Request) => S.userOf(req);
const id = (req: Request) => String(req.params.id);

savedRouter.get('/me', (req, res) => res.json({ user: u(req) }));
savedRouter.get('/', (req, res) => res.json({ queries: S.list(u(req)) }));
savedRouter.post('/', h(async (req, res) => res.status(201).json(await S.create(req.body, u(req)))));
savedRouter.get('/:id', h((req, res) => res.json(S.get(id(req), u(req)).current)));
savedRouter.put('/:id', h(async (req, res) => res.json(await S.update(id(req), req.body, u(req)))));
savedRouter.delete('/:id', h(async (req, res) => { await S.remove(id(req), u(req)); res.json({ ok: true }); }));
savedRouter.post('/:id/duplicate', h(async (req, res) => res.status(201).json(await S.duplicate(id(req), u(req)))));
savedRouter.get('/:id/versions', h((req, res) => res.json({ versions: S.versions(id(req), u(req)) })));
savedRouter.post('/:id/rollback', h(async (req, res) => res.json(await S.rollback(id(req), Number(req.body?.version), u(req)))));
