import { Router } from 'express';
import type { Entity, GlobalFilters, Group, Node, QueryOptions } from '../../shared/types';
import { EMPTY_FILTERS } from '../../shared/types';
import { filtersToTree } from '../../shared/filters';
import { WIDGETS, WIDGET_BY_ID, makeCtx, requiredColumns } from '../overviewWidgets';
import { BuilderError } from '../sqlBuilder';
import { cleanExtras, widgetScope } from '../overviewScope';
import { canonicalSource } from '../overviewSource';
import { createLimiter, query } from '../db';
import { userToken } from '../auth';
import { cached, scopeOf } from '../cache';
import { getField, isSelectableColumn } from '../fieldCatalog';
import { logMeta } from '../log';

export const overviewRouter = Router();
/** Shared across requests so the warehouse never sees more than 4 concurrent widget statements. */
const widgetLimit = createLimiter(4);

overviewRouter.get('/widgets/ids', (_req, res) => res.json({ widgets: WIDGETS.map((w) => ({ id: w.id, entity: w.entity })) }));

/** Global filters on columns this table does not have are ignored for that table (the widget still renders). */
function pruneTree(entity: Entity, tree: Group): { tree: Group; ignored: string[] } {
  const ignored: string[] = [];
  const walk = (n: Node): Node | null => {
    if (n.type === 'condition') {
      if (getField(entity, n.field)) return n;
      ignored.push(n.field);
      return null;
    }
    return { ...n, children: n.children.map(walk).filter((c): c is Node => !!c) };
  };
  return { tree: walk(tree) as Group, ignored };
}

overviewRouter.post('/widgets', async (req, res, next) => {
  try {
    const { filters, options, widgets, fresh } = req.body ?? {};
    if (!Array.isArray(widgets) || !widgets.length || widgets.length > 50) throw new BuilderError('widgets must be a non-empty array');
    const f: GlobalFilters = { ...EMPTY_FILTERS, ...(filters ?? {}) };
    const opts: QueryOptions = { latestSnapshotOnly: options?.latestSnapshotOnly !== false };
    const extras = cleanExtras(f.extra); // reject bad filters once, up front (400), instead of failing every card
    const full = filtersToTree(f);
    const token = userToken(req);
    const scope = scopeOf(token);
    const ac = new AbortController();
    res.on('close', () => !res.writableEnded && ac.abort());

    const defs = widgets.map((id: unknown) => {
      const def = typeof id === 'string' ? WIDGET_BY_ID.get(id) : undefined;
      if (!def) throw new BuilderError(`Unknown widget: ${String(id).slice(0, 40)}`);
      return def;
    });

    const results = await Promise.all(
      defs.map((def) =>
        widgetLimit(async () => {
          const t = Date.now();
          if (ac.signal.aborted) return [def.id, { error: 'Cancelled' }] as const;
          // Skip (instead of failing) when the data does not have a column this widget needs.
          const missing = requiredColumns(def).filter((col) => !isSelectableColumn(def.entity, col));
          if (missing.length) return [def.id, { unavailable: `Not available: this table has no column ${missing.map((m) => '“' + m + '”').join(', ')}. Map it with COLUMN_MAP if it is named differently.` }] as const;
          try {
            const { tree, ignored } = pruneTree(def.entity, full);
            const { where, params } = widgetScope(def.entity, tree, extras, opts);
            const sql = def.sql(makeCtx(canonicalSource(def.entity), where));
            const run = () => query(sql, params, { userToken: token, signal: ac.signal });
            const rows = await cached(`w|${scope}|${sql}|${JSON.stringify(params)}`, run, { fresh: !!fresh });
            return [def.id, { rows, elapsedMs: Date.now() - t, ...(ignored.length ? { ignoredFilters: [...new Set(ignored)] } : {}) }] as const;
          } catch (e: any) {
            return [def.id, { error: e?.message ?? 'Widget query failed' }] as const;
          }
        }),
      ),
    );
    logMeta(res, { widgets: defs.length, errors: results.filter(([, r]) => 'error' in r).length });
    res.json(Object.fromEntries(results));
  } catch (e) {
    next(e);
  }
});
