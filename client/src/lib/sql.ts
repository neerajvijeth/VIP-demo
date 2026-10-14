/** Display-only: substitute :pN markers with literals so the statement reads (and copies) as plain SQL. */
export function inlineParams(sql: string, params: Record<string, string | number | boolean>): string {
  return sql.replace(/:p(\d+)\b/g, (m, n) => {
    const v = params[`p${n}`];
    if (v === undefined) return m;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  });
}

const KEYWORDS = /\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|OFFSET|AND|OR|NOT|IN|IS|NULL|LIKE|RLIKE|BETWEEN|CAST|AS|DATE|LOWER|COALESCE|MAX|COUNT|ASC|DESC|NULLS LAST|TRUE|FALSE|DISTINCT)\b/g;
export type SqlPart = { t: 'kw' | 'ident' | 'str' | 'num' | 'text'; s: string };
export function tokenizeSql(sql: string): SqlPart[] {
  const out: SqlPart[] = [];
  const re = /(`[^`]+`)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]+(?: BY| LAST)?)|([\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (m[1]) out.push({ t: 'ident', s: m[1] });
    else if (m[2]) out.push({ t: 'str', s: m[2] });
    else if (m[3]) out.push({ t: 'num', s: m[3] });
    else if (m[4]) out.push({ t: KEYWORDS.test(m[4]) ? 'kw' : 'text', s: m[4] }), (KEYWORDS.lastIndex = 0);
    else out.push({ t: 'text', s: m[5] });
  }
  return out;
}

/** Readable layout: top-level clauses on their own line, AND/OR on their own line indented by bracket depth. */
export function formatSql(sql: string): string {
  let out = '';
  let depth = 0;
  let between = false;
  for (const p of tokenizeSql(sql)) {
    if (p.t === 'text' && p.s === '(') depth++;
    else if (p.t === 'text' && p.s === ')') depth = Math.max(0, depth - 1);
    else if (p.t === 'kw') {
      const k = p.s;
      if (k === 'BETWEEN') between = true;
      if (depth === 0 && ['FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET'].includes(k)) {
        out = out.trimEnd() + '\n' + k;
        continue;
      }
      if (k === 'AND' && between) between = false;
      else if (k === 'AND' || k === 'OR') {
        out = out.trimEnd() + '\n' + '  '.repeat(depth + 1) + k;
        continue;
      }
    }
    out += p.s;
  }
  return out.trim();
}
