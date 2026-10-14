import { Router } from 'express';
import { columnChoices, defaultColumns, getCatalog, getField, getSchemaInfo, isEntity, scopeAvailability } from '../fieldCatalog';
import { ensureFreshSchema, syncSchema } from '../schema';
import { BuilderError, quoteIdent } from '../sqlBuilder';
import { L } from '../../shared/semantics';
import { cached, clearCache, scopeOf } from '../cache';
import { runDataCheck } from '../dataCheck';
import { entityTable } from '../config';
import { query } from '../db';
import { userToken } from '../auth';

export const metaRouter = Router();

metaRouter.get('/fields', async (req, res, next) => {
  try {
    const entity = req.query.entity;
    if (!isEntity(entity)) throw new BuilderError('entity must be "assets" or "vulnerabilities"');
    await ensureFreshSchema(30 * 60_000, userToken(req)).catch(() => undefined);
    res.json({ entity, fields: getCatalog(entity), columns: columnChoices(entity), defaultColumns: defaultColumns(entity), schema: getSchemaInfo(entity), scope: scopeAvailability(entity) });
  } catch (e) {
    next(e);
  }
});

/** Mismatches between the configured business values and the data (shown as a banner on Overview). */
metaRouter.get('/data-check', async (req, res, next) => {
  try {
    res.json(await runDataCheck(userToken(req)));
  } catch (e) {
    next(e);
  }
});

/** Re-discover columns and types from the warehouse on demand. */
metaRouter.post('/refresh-schema', async (req, res, next) => {
  try {
    clearCache();
    await syncSchema(userToken(req));
    res.json({ ok: true, assets: getSchemaInfo('assets'), vulnerabilities: getSchemaInfo('vulnerabilities') });
  } catch (e) {
    next(e);
  }
});

metaRouter.get('/values', async (req, res, next) => {
  try {
    const { entity, field } = req.query;
    if (!isEntity(entity)) throw new BuilderError('entity must be "assets" or "vulnerabilities"');
    const f = typeof field === 'string' ? getField(entity, field) : undefined;
    if (!f) throw new BuilderError('Unknown field');
    if (f.type === 'boolean') return void res.json({ values: ['true', 'false'] });
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100).trim() : '';
    const token = userToken(req);

    const col = quoteIdent(f.key);
    const str = `CAST(${col} AS STRING)`;
    const params: Record<string, string> = {};
    let where = `${col} IS NOT NULL AND ${str} <> ''`;
    if (q) {
      where += ` AND LOWER(${str}) LIKE LOWER(:q)`;
      params.q = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    }
    const sql = `SELECT DISTINCT ${str} AS v FROM ${entityTable(entity)} WHERE ${where} ORDER BY v LIMIT 50`;
    const rows = await cached(`v|${scopeOf(token)}|${sql}|${JSON.stringify(params)}`, () => query(sql, params, { userToken: token }), { ttlMs: 10 * 60_000 });
    res.json({ values: rows.map((r) => String(r.v)) });
  } catch (e) {
    next(e);
  }
});

/** Latest snapshot per table (drives "last refreshed" and the sidebar badges' freshness). */
metaRouter.get('/refreshed', async (req, res, next) => {
  try {
    const token = userToken(req);
    const [a, v] = await Promise.all(
      (['assets', 'vulnerabilities'] as const).map((e) => {
        const sql = `SELECT CAST(MAX(${quoteIdent(L('snapshot_date'))}) AS STRING) AS d FROM ${entityTable(e)}`;
        return cached(`r|${scopeOf(token)}|${sql}`, () => query(sql, {}, { userToken: token }), { fresh: req.query.fresh === '1' }).catch(() => [{ d: null }]);
      }),
    );
    res.json({ assets: a[0]?.d ?? null, vulnerabilities: v[0]?.d ?? null });
  } catch (e) {
    next(e);
  }
});
