import { Router, type Response } from 'express';
import { once } from 'node:events';
import { csvRow } from '../../shared/csv';
import { buildCount, buildDetail, buildExport, buildRun, buildSummary } from '../sqlBuilder';
import { config } from '../config';
import { query, streamQuery } from '../db';
import { userToken } from '../auth';
import { logMeta } from '../log';
import { cached, scopeOf } from '../cache';

export const queryRouter = Router();

const abortOnClose = (res: Response) => {
  const ac = new AbortController();
  res.on('close', () => !res.writableEnded && ac.abort());
  return ac;
};

queryRouter.post('/run', async (req, res, next) => {
  try {
    if (req.body?.mode === 'summary') {
      const sb = buildSummary(req.body);
      const token = userToken(req);
      const ac = abortOnClose(res);
      const t = Date.now();
      const [rows, count] = await Promise.all([
        query(sb.sql, sb.params, { userToken: token, signal: ac.signal }),
        query(sb.countSql, sb.countParams, { userToken: token, signal: ac.signal }),
      ]);
      logMeta(res, { entity: sb.entity, mode: 'summary', rows: rows.length });
      return void res.json({ columns: sb.columns, labels: sb.labels, rows, total: Number(count[0]?.total ?? 0), sql: sb.sql, params: sb.params, elapsedMs: Date.now() - t });
    }
    const b = buildRun(req.body ?? {});
    const token = userToken(req);
    const ac = abortOnClose(res);
    const t = Date.now();
    const [rows, count] = await Promise.all([
      query(b.sql, b.params, { userToken: token, signal: ac.signal }),
      query(b.countSql, b.countParams, { userToken: token, signal: ac.signal }),
    ]);
    const total = Number(count[0]?.total ?? 0);
    logMeta(res, { entity: b.entity, rows: rows.length, total });
    res.json({ columns: b.columns, rows, total, sql: b.sql, params: b.params, elapsedMs: Date.now() - t });
  } catch (e) {
    next(e);
  }
});

queryRouter.post('/count', async (req, res, next) => {
  try {
    const b = buildCount(req.body ?? {});
    const ac = abortOnClose(res);
    const token = userToken(req);
    // Counts power the live "N matching" and the sidebar badges: identical counts within the TTL cost one warehouse query.
    const rows = await cached(`c|${scopeOf(token)}|${b.sql}|${JSON.stringify(b.params)}`, () => query(b.sql, b.params, { userToken: token, signal: ac.signal }), { fresh: !!req.body?.fresh });
    logMeta(res, { entity: b.entity });
    res.json({ total: Number(rows[0]?.total ?? 0) });
  } catch (e) {
    next(e);
  }
});

/** Read-only SQL preview for the "Show SQL" drawer (no warehouse call). */
queryRouter.post('/preview', (req, res, next) => {
  try {
    if (req.body?.mode === 'summary') {
      const sb = buildSummary(req.body);
      return void res.json({ sql: sb.sql, params: sb.params });
    }
    const b = buildRun({ page: 0, pageSize: 50, ...(req.body ?? {}) });
    res.json({ sql: b.sql, params: b.params });
  } catch (e) {
    next(e);
  }
});

queryRouter.get('/detail', async (req, res, next) => {
  try {
    const b = buildDetail(req.query.entity, req.query.key, req.query.snapshot);
    const rows = await query(b.sql, b.params, { userToken: userToken(req) });
    if (!rows.length) return void res.status(404).json({ error: 'Row not found' });
    logMeta(res, { entity: b.entity });
    res.json({ row: rows[0] });
  } catch (e) {
    next(e);
  }
});

/** Streams ALL matching rows as CSV. Accepts JSON or a form post with a `payload` JSON field. */
queryRouter.post('/export', async (req, res, next) => {
  let started = false;
  try {
    let body = req.body ?? {};
    if (typeof body.payload === 'string') body = JSON.parse(body.payload);
    const summary = body.mode === 'summary' ? buildSummary(body, { noLimit: true }) : null;
    const b = summary
      ? { entity: summary.entity, columns: summary.columns, headers: summary.labels, sql: summary.sql, params: summary.params, countSql: summary.countSql }
      : { ...buildExport(body), headers: undefined as string[] | undefined };
    const token = userToken(req);
    const ac = abortOnClose(res);

    const countRows = await query(b.countSql, summary ? summary.countParams : b.params, { userToken: token, signal: ac.signal });
    const total = Number(countRows[0]?.total ?? 0);
    const cap = config.exportMaxRows;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12).replace(/^(\d{8})(\d{4})$/, '$1_$2');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${b.entity}_${stamp}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Export-Total', String(total));
    res.setHeader('X-Export-Truncated', String(total > cap));
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Total, X-Export-Truncated, Content-Disposition');
    res.flushHeaders();
    started = true;
    res.write('﻿' + csvRow(b.headers ?? b.columns));

    let written = 0;
    await streamQuery(
      b.sql,
      b.params,
      async (rows) => {
        const take = Math.min(rows.length, cap - written);
        let buf = '';
        for (let i = 0; i < take; i++) buf += csvRow(b.columns.map((c) => rows[i][c]));
        written += take;
        if (!res.write(buf)) await Promise.race([once(res, 'drain'), once(res, 'close')]); // backpressure
        return written < cap && !ac.signal.aborted;
      },
      { userToken: token, signal: ac.signal, chunkSize: 5000 },
    );
    logMeta(res, { entity: b.entity, rows: written, truncated: total > cap });
    res.end();
  } catch (e) {
    if (started) {
      // Headers are already sent; abort the stream so the client sees a failed download.
      console.error('export failed mid-stream:', (e as Error)?.message);
      res.destroy(e as Error);
    } else next(e);
  }
});
