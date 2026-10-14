import { Router } from 'express';
import { once } from 'node:events';
import { csvRow } from '../../shared/csv';
import { validateCustomSql } from '../customSql';
import { config } from '../config';
import { runReadOnly, streamQuery } from '../db';
import { userToken } from '../auth';
import { logMeta } from '../log';
import { BuilderError } from '../sqlBuilder';

/** A failing user statement (syntax, missing column…) is the user's to fix: surface the warehouse message as a 400. */
const userError = (e: unknown) => (e instanceof BuilderError ? e : Object.assign(new BuilderError(String((e as Error)?.message ?? e).replace(/^\[?[A-Z_.]+\]?\s*/, (m) => m).slice(0, 1200)), { status: 400 }));

/**
 * Read-only ad-hoc SQL. Guardrails (defence in depth): statement allow-list + forbidden keyword/function checks (customSql.ts),
 * row cap, statement timeout (session setting), and — the real enforcement — the caller's Databricks privileges
 * (the app's service principal only holds SELECT on the three gold tables).
 */
export const customRouter = Router();

const MAX_ROWS = 10_000;
const DEFAULT_ROWS = 1_000;

customRouter.post('/run', async (req, res, next) => {
  try {
    const sql = validateCustomSql(req.body?.sql);
    const maxRows = Math.min(Math.max(Number(req.body?.maxRows) || DEFAULT_ROWS, 1), MAX_ROWS);
    const ac = new AbortController();
    res.on('close', () => !res.writableEnded && ac.abort());
    const t = Date.now();
    const r = await runReadOnly(sql, { maxRows, userToken: userToken(req), signal: ac.signal });
    logMeta(res, { custom: true, sqlChars: sql.length, rows: r.rows.length, truncated: r.truncated });
    res.json({ ...r, maxRows, elapsedMs: Date.now() - t });
  } catch (e) {
    next(userError(e));
  }
});

customRouter.post('/export', async (req, res, next) => {
  let started = false;
  try {
    let body = req.body ?? {};
    if (typeof body.payload === 'string') body = JSON.parse(body.payload);
    const sql = validateCustomSql(body.sql);
    const ac = new AbortController();
    res.on('close', () => !res.writableEnded && ac.abort());
    const cap = config.exportMaxRows;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12).replace(/^(\d{8})(\d{4})$/, '$1_$2');
    let written = 0;
    let columns: string[] = [];

    await streamQuery(
      sql,
      {},
      async (rows) => {
        const take = Math.min(rows.length, cap - written);
        let buf = '';
        for (let i = 0; i < take; i++) buf += csvRow(columns.map((c) => rows[i][c]));
        written += take;
        if (buf && !res.write(buf)) await Promise.race([once(res, 'drain'), once(res, 'close')]);
        return written < cap && !ac.signal.aborted;
      },
      {
        userToken: userToken(req),
        signal: ac.signal,
        chunkSize: 5000,
        onSchema: (cols) => {
          columns = cols;
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="custom_query_${stamp}.csv"`);
          res.setHeader('Cache-Control', 'no-store');
          res.flushHeaders();
          started = true;
          res.write('﻿' + csvRow(cols));
        },
      },
    );
    logMeta(res, { custom: true, sqlChars: sql.length, rows: written });
    res.end();
  } catch (e) {
    if (started) {
      console.error('custom export failed mid-stream:', (e as Error)?.message);
      res.destroy(e as Error);
    } else next(userError(e));
  }
});
