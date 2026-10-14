import { Router } from 'express';
import { kpiTable } from '../config';
import { cached, scopeOf } from '../cache';
import { L } from '../../shared/semantics';
import { quoteIdent } from '../sqlBuilder';
import { query } from '../db';
import { userToken } from '../auth';

export const kpisRouter = Router();

const q = (logical: string) => quoteIdent(L(logical));

/** Trend data from the KPI table only (never filtered; it has no dimension columns). Cached; `?fresh=1` bypasses. */
kpisRouter.get('/', async (req, res, next) => {
  try {
    const token = userToken(req);
    const sql = `SELECT ${q('metric_name')} AS metric_name, ${q('metric_value')} AS metric_value, CAST(${q('snapshot_date')} AS STRING) AS snapshot_date FROM ${kpiTable()} ORDER BY ${q('snapshot_date')} ASC`;
    const rows = await cached(`k|${scopeOf(token)}|${sql}`, () => query(sql, {}, { userToken: token }), { fresh: req.query.fresh === '1' });
    const metrics: Record<string, { date: string; value: number | null }[]> = {};
    for (const r of rows) {
      const name = String(r.metric_name);
      const raw = r.metric_value;
      const value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
      (metrics[name] ??= []).push({ date: String(r.snapshot_date).slice(0, 10), value: Number.isFinite(value as number) ? value : null });
    }
    res.json({ metrics });
  } catch (e) {
    next(e);
  }
});
