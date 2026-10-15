import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config';
import { semantics } from '../shared/semantics';
import { requestLogger } from './log';
import { BuilderError } from './sqlBuilder';
import { metaRouter } from './routes/meta';
import { queryRouter } from './routes/query';
import { overviewRouter } from './routes/overview';
import { kpisRouter } from './routes/kpis';
import { genieRouter } from './routes/genie';
import { customRouter } from './routes/custom';
import { savedRouter } from './routes/saved';
import { hasLiveColumns } from './fieldCatalog';
import { ensureFreshSchema } from './schema';
import { userToken } from './auth';
import { cacheStats } from './cache';
import { pingWarehouse, warehouseStats } from './db';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(requestLogger);
app.use(helmet({ contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'style-src': ["'self'", "'unsafe-inline'"], 'script-src': ["'self'"], 'connect-src': ["'self'"], 'font-src': ["'self'", 'data:'] } } }));
// Do not compress the CSV stream or SSE (flush latency / buffering).
app.use(compression({ filter: (req, res) => !req.path.endsWith('/export') && !req.path.endsWith('/poll') && compression.filter(req, res) }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', async (_req, res) => {
  const base = { ok: true, env: config.env, genie: !!config.genieSpaceId, usage: { ...warehouseStats, uptimeSec: Math.round((Date.now() - warehouseStats.startedAt) / 1000), cache: cacheStats, cacheTtlSec: config.cacheTtlMs / 1000 }, liveColumns: { assets: hasLiveColumns('assets'), vulnerabilities: hasLiveColumns('vulnerabilities') } };
  if (_req.query.deep === '1') {
    try {
      res.json({ ...base, warehouseMs: await pingWarehouse() });
    } catch (e: any) {
      res.status(503).json({ ...base, ok: false, error: e?.message });
    }
  } else res.json(base);
});
app.get('/api/env', (_req, res) => res.json({ env: config.env, exportMaxRows: config.exportMaxRows, catalog: config.catalog, schema: config.schema, semantics: semantics() }));

// Make sure the discovered schema is loaded before any data route builds SQL (lazy, cached, backs off on failure).
app.use(['/api/meta', '/api/query', '/api/overview'], (req, _res, next) => {
  ensureFreshSchema(30 * 60_000, userToken(req)).then(() => next(), () => next());
});

app.use('/api/meta', metaRouter);
app.use('/api/query', queryRouter);
app.use('/api/overview', overviewRouter);
app.use('/api/kpis', kpisRouter);
app.use('/api/genie', genieRouter);
app.use('/api/custom', customRouter);
app.use('/api/saved', savedRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Static SPA (built client)
const clientDir = path.resolve(__dirname, '../../client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return void res.end();
  if (err instanceof BuilderError) return void res.status((err as any).status ?? 400).json({ error: err.message });
  if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'Request body too large' });
  if (err instanceof SyntaxError) return void res.status(400).json({ error: 'Invalid JSON' });
  const status = typeof err?.status === 'number' ? err.status : 500;
  console.error(JSON.stringify({ id: (req as any).id, error: err?.message }));
  res.status(status).json({ error: status === 500 ? 'Query failed' : err.message, detail: err?.message });
};
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Vulnerability Intelligence Platform listening on :${config.port} (${config.env})`);
    // Schema discovery is lazy (first data request, then at most every 30 min while in use):
    // nothing here wakes the SQL warehouse on its own.
  });
}
export { app };
