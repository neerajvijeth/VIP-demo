import { Router } from 'express';
import { kpiTable } from '../config';
import { cached, scopeOf } from '../cache';
import { L } from '../../shared/semantics';
import { quoteIdent } from '../sqlBuilder';
import { query } from '../db';
import { userToken } from '../auth';

export const kpisRouter = Router();

const q = (logical: string) => quoteIdent(L(logical));

/** A day whose headline count moves by more than this versus the previous day is flagged as a suspect run. */
const SUSPECT_RATIO = 0.5;
const ANCHORS = ['unique_managed_assets', 'gold_finding_records', 'unique_asset_vulnerability_pairs'];

/**
 * Trend data from the KPI table only (never filtered; it has no dimension columns). Cached; `?fresh=1` bypasses.
 *  - one run per day: the newest snapshot_timestamp holding at least 80% of that day's largest metric set (partial runs are skipped,
 *    and a day that was run twice is not charted twice)
 *  - "previous" is the previous distinct date
 *  - a day whose headline counts jump by more than 50% is returned in `suspectDates` so the UI shows it as suspect, not as a collapse
 */
kpisRouter.get('/', async (req, res, next) => {
  try {
    const token = userToken(req);
    const K = kpiTable();
    const d = q('snapshot_date'), ts = q('snapshot_timestamp'), m = q('metric_name'), val = q('metric_value');
    const runSql = `WITH r AS (SELECT ${d} AS d, ${ts} AS ts, COUNT(DISTINCT ${m}) AS n FROM ${K} GROUP BY 1, 2),
mx AS (SELECT d, MAX(n) AS mn FROM r GROUP BY d),
cand AS (SELECT r.d, r.ts, ROW_NUMBER() OVER (PARTITION BY r.d ORDER BY r.ts DESC) AS rn FROM r JOIN mx ON r.d = mx.d WHERE r.n >= 0.8 * mx.mn),
tot AS (SELECT COUNT(*) AS c FROM r)
SELECT k.${m} AS metric_name, k.${val} AS metric_value, CAST(k.${d} AS STRING) AS snapshot_date, (SELECT c FROM tot) - (SELECT COUNT(*) FROM cand WHERE rn = 1) AS skipped
FROM ${K} k JOIN cand c ON k.${d} = c.d AND k.${ts} = c.ts AND c.rn = 1 ORDER BY k.${d} ASC`;
    const plainSql = `SELECT ${m} AS metric_name, ${val} AS metric_value, CAST(${d} AS STRING) AS snapshot_date, 0 AS skipped FROM ${K} ORDER BY ${d} ASC`;
    // tables without a run timestamp fall back to the plain read
    const rows = await cached(`k2|${scopeOf(token)}|${runSql}`, () => query(runSql, {}, { userToken: token }).catch(() => query(plainSql, {}, { userToken: token })), { fresh: req.query.fresh === '1' });
    const metrics: Record<string, { date: string; value: number | null; suspect?: boolean }[]> = {};
    for (const r of rows) {
      const name = String(r.metric_name);
      const raw = r.metric_value;
      const value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
      (metrics[name] ??= []).push({ date: String(r.snapshot_date).slice(0, 10), value: Number.isFinite(value as number) ? value : null });
    }
    const suspect = new Set<string>();
    for (const a of ANCHORS.filter((n) => metrics[n])) {
      const pts = metrics[a];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1].value, c = pts[i].value;
        if (p && c !== null && Math.abs(c - p) / p > SUSPECT_RATIO) suspect.add(pts[i].date);
      }
    }
    for (const pts of Object.values(metrics)) for (const p of pts) if (suspect.has(p.date)) p.suspect = true;
    res.json({ metrics, suspectDates: [...suspect].sort(), skippedRuns: Number(rows[0]?.skipped ?? 0) });
  } catch (e) {
    next(e);
  }
});
