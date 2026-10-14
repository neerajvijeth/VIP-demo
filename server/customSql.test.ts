import { describe, it, expect } from 'vitest';
import { validateCustomSql } from './customSql';

const ok = (s: string) => expect(() => validateCustomSql(s)).not.toThrow();
const bad = (s: string, re?: RegExp) => expect(() => validateCustomSql(s)).toThrow(re);

describe('custom SQL guard', () => {
  it('allows read-only statements', () => {
    ok('SELECT * FROM workspace.default.gold_assets LIMIT 10');
    ok('select hostname, count(*) c from t group by 1 order by c desc;');
    ok('WITH x AS (SELECT 1 a) SELECT * FROM x');
    ok('  (SELECT 1)  ');
    ok('DESCRIBE TABLE workspace.default.gold_assets');
    ok('SHOW TABLES IN workspace.default');
    ok('EXPLAIN SELECT 1');
    ok('SELECT 1 -- trailing comment');
    ok('/* lead */ SELECT 1');
  });
  it('strips one trailing semicolon', () => {
    expect(validateCustomSql('SELECT 1;  ')).toBe('SELECT 1');
  });
  it('rejects anything that writes or changes state', () => {
    for (const s of [
      'INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'DELETE FROM t', 'MERGE INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE',
      'DROP TABLE t', 'CREATE TABLE x AS SELECT 1', 'ALTER TABLE t ADD COLUMN c int', 'TRUNCATE TABLE t', 'GRANT SELECT ON t TO u',
      'COPY INTO t FROM s', 'SET x = 1', 'USE CATALOG main', 'OPTIMIZE t', 'VACUUM t', 'CALL proc()',
    ]) bad(s);
  });
  it('rejects writes hidden inside a CTE or after a comment', () => {
    bad('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', /INSERT/);
    bad('SELECT 1; DROP TABLE t', /one statement/);
    bad('SELECT 1 -- ok\n; DELETE FROM t', /one statement/);
    bad('/* SELECT */ DROP TABLE t');
  });
  it('does not trip on keywords inside strings, comments or identifiers', () => {
    ok("SELECT 'DROP TABLE x; DELETE' AS note");
    ok('SELECT `drop`, `delete` FROM t');
    ok('SELECT 1 /* UPDATE */');
    ok('SELECT te_updated_at, created_by FROM t');
    ok("SELECT * FROM t WHERE a = 'it''s; fine'");
  });
  it('rejects escape-hatch functions', () => {
    bad("SELECT reflect('java.lang.Runtime', 'getRuntime')", /reflect/);
    bad("SELECT java_method('java.lang.System','getenv','X')", /java_method/);
    bad("SELECT * FROM read_files('s3://bucket/x')", /read_files/);
    bad("SELECT http_request(conn, 'GET', '/')", /http_request/);
  });
  it('rejects empty, oversized or unterminated input', () => {
    bad('', /Enter a SQL/);
    bad('   ');
    bad(undefined as any);
    bad('SELECT ' + 'a'.repeat(20_001), /too long/);
    bad("SELECT 'unterminated", /Unterminated/);
    bad('SELECT 1 /* open', /Unterminated/);
    bad('hello world', /read-only statements/);
  });
});
