import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/** Request ids + structured logs. Never logs request bodies or parameter values. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) || randomUUID().slice(0, 8);
  (req as any).id = id;
  res.setHeader('x-request-id', id);
  const t = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return;
    const m = (res.locals.logMeta ?? {}) as Record<string, unknown>;
    console.log(JSON.stringify({ t: new Date().toISOString(), id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t, ...m }));
  });
  next();
}
export const logMeta = (res: Response, meta: Record<string, unknown>) => Object.assign((res.locals.logMeta ??= {}), meta);
