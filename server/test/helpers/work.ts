import type Database from 'better-sqlite3';

/**
 * The database work `fn` does: statements prepared, rows they returned, and
 * every step of their query plans that walks a whole table or index rather
 * than searching one (LAI-779's measure, from `estimates.test.ts`). A query
 * per row adds statements, a read of a whole table adds rows, and a scan shows
 * as `SCAN` — none of which a slow machine can fake or hide.
 */
export function work(
  sqlite: Database.Database,
  fn: () => void,
): { statements: number; rows: number; scans: string[] } {
  const prepare = sqlite.prepare.bind(sqlite);
  const ran: { source: string; params: unknown[] }[] = [];
  let statements = 0;
  let rows = 0;
  sqlite.prepare = ((source: string) => {
    statements += 1;
    const stmt = prepare(source) as Database.Statement<unknown[], unknown>;
    const [get, all, run] = [stmt.get.bind(stmt), stmt.all.bind(stmt), stmt.run.bind(stmt)];
    stmt.get = (...params: unknown[]) => {
      ran.push({ source, params });
      const row: unknown = get(...params);
      if (row !== undefined) rows += 1;
      return row;
    };
    stmt.all = (...params: unknown[]) => {
      ran.push({ source, params });
      const found: unknown[] = all(...params);
      rows += found.length;
      return found;
    };
    stmt.run = (...params: unknown[]) => {
      ran.push({ source, params });
      return run(...params);
    };
    return stmt;
  }) as typeof sqlite.prepare;
  try {
    fn();
  } finally {
    // The method lives on the prototype: dropping the shadow restores it.
    Reflect.deleteProperty(sqlite, 'prepare');
  }
  const scans = ran.flatMap(({ source, params }) =>
    /^\s*(SELECT|WITH)/i.test(source)
      ? (sqlite.prepare(`EXPLAIN QUERY PLAN ${source}`).all(...params) as { detail: string }[])
          .map((step) => step.detail)
          .filter((detail) => detail.startsWith('SCAN ') && detail !== 'SCAN CONSTANT ROW')
      : [],
  );
  return { statements, rows, scans };
}
