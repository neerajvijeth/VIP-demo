import { BuilderError } from './sqlBuilder';

export const CUSTOM_SQL_MAX_LENGTH = 20_000;

/** Statements that only read data (or metadata). Everything else is rejected before it reaches the warehouse. */
const ALLOWED_FIRST = new Set(['SELECT', 'WITH', 'DESCRIBE', 'DESC', 'SHOW', 'EXPLAIN']);
const FORBIDDEN_WORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'DENY', 'COPY', 'CALL', 'SET', 'USE',
  'OPTIMIZE', 'VACUUM', 'REFRESH', 'INTO', 'LOAD', 'EXEC', 'EXECUTE', 'RESTORE', 'MSCK', 'ANALYZE', 'REORG', 'UNSET', 'COMMENT', 'CACHE', 'UNCACHE', 'CLONE',
];
/** Functions that reach outside the SQL sandbox (JVM reflection, HTTP, external files, foreign queries). */
const FORBIDDEN_FUNCTIONS = ['reflect', 'try_reflect', 'java_method', 'read_files', 'http_request', 'remote_query', 'read_kafka', 'read_state_store', 'input_file_name'];

/** Removes comments and string/identifier literals so keyword checks cannot be fooled or trip on data. */
export function skeleton(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; ) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') i++; out += ' '; continue; }
    if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new BuilderError('Unterminated comment');
      i = end + 2; out += ' '; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      for (;;) {
        if (i >= sql.length) throw new BuilderError('Unterminated quote');
        if (sql[i] === '\\' && q !== '`') { i += 2; continue; }
        if (sql[i] === q) { if (sql[i + 1] === q) { i += 2; continue; } i++; break; }
        i++;
      }
      out += q === '`' ? ' ident ' : " '' ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Returns the statement to run (trimmed, trailing semicolon removed) or throws a 400 with a clear reason. */
export function validateCustomSql(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new BuilderError('Enter a SQL statement to run');
  if (raw.length > CUSTOM_SQL_MAX_LENGTH) throw new BuilderError(`SQL is too long (max ${CUSTOM_SQL_MAX_LENGTH} characters)`);
  const sql = raw.trim().replace(/;+\s*$/, '');
  const sk = skeleton(sql);
  if (sk.includes(';')) throw new BuilderError('Only one statement can be run at a time (remove the extra semicolon)');
  const first = /^\s*\(?\s*([A-Za-z]+)/.exec(sk)?.[1]?.toUpperCase();
  if (!first || !ALLOWED_FIRST.has(first)) throw new BuilderError('Only read-only statements are allowed: SELECT, WITH, DESCRIBE, SHOW or EXPLAIN');
  const upper = sk.toUpperCase();
  for (const w of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${w}\\b`).test(upper)) throw new BuilderError(`"${w}" is not allowed: custom SQL is read-only`);
  }
  for (const f of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${f}\\s*\\(`, 'i').test(sk)) throw new BuilderError(`The function ${f}() is not allowed`);
  }
  return sql;
}
