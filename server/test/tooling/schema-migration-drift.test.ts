import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declaredSchema, normaliseSql, type DeclaredTable } from '../helpers/declared-schema.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * `src/db/schema.ts` against the database the migrations actually build (LAI-061).
 *
 * ## Why this is not covered by anything else
 *
 * `schema.ts` is Drizzle's *declaration*. Every test, and the server itself, runs
 * against a database built from `src/db/migrations/*.sql`. Nothing compared the
 * two, so an edit to the declaration alone changed nothing observable: during the
 * LAI-050 review, `tasks.sprint_id` was switched from `ON DELETE set null` to
 * `cascade` — the edit that makes deleting a sprint destroy every task in it — and
 * all 615 tests passed.
 *
 * The damage is deferred rather than absent. The next `drizzle-kit generate` emits
 * a migration carrying whatever stale edit is sitting in `schema.ts`, attributed
 * to whichever task happened to run the generator. A silent `ON DELETE cascade`
 * arriving that way is data loss with no author.
 *
 * ## How it compares
 *
 * The declaration is **run** (`test/helpers/declared-schema.ts`, shared with
 * `schema-spec-drift.test.ts` so the two cannot disagree about what `schema.ts`
 * says). The migrated database is **introspected** — `PRAGMA table_info`,
 * `PRAGMA foreign_key_list`, `PRAGMA index_list` and the DDL in `sqlite_master`.
 * Neither side is parsed from source, and both are the real thing.
 *
 * Deliberately not a snapshot hash. A hash tells you something moved and nothing
 * about what, so the first person to hit it regenerates it and the check is gone.
 * Every assertion here names the object and the direction: what `schema.ts` says
 * against what the migrations produced.
 *
 * **Triggers are out of scope** and that is a real hole, not an oversight: Drizzle
 * cannot declare one, so `activity`'s append-only triggers exist only in the
 * migrations. LAI-044's test guards those behaviourally instead, by attempting an
 * `UPDATE` and a `DELETE`.
 *
 * ## There is no "planned" mark here, and that is deliberate (LAI-080)
 *
 * The spec↔schema check above it needs one: D-011 makes the spec authoritative,
 * so a decision is written down before it is built, and the interval between the
 * two is a **normal** state. Marking it is what stops a legitimate state from
 * turning master red.
 *
 * This check has no equivalent interval. A migration is generated *from* the
 * declaration by `drizzle-kit generate`, mechanically, in the same change — there
 * is no judgement between the two and nothing to schedule. So "declared but not
 * yet migrated" is never a plan; it is always somebody forgetting to run the
 * generator, and the next boot applies a migration set that does not build the
 * schema the code expects.
 *
 * Adding a mark here would therefore create exactly one new capability: a way to
 * ship a schema the database does not have, with a comment explaining that it
 * was on purpose. It is not built for that reason, not because nobody thought
 * about it.
 */

let t: TestDb;
let declared: Map<string, DeclaredTable>;

interface LiveColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKeyPosition: number;
  hasDefault: boolean;
}

interface LiveForeignKey {
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string;
  onUpdate: string;
}

interface LiveIndex {
  name: string;
  unique: boolean;
  columns: string[];
  where: string | null;
}

interface LiveCheck {
  name: string;
  expression: string;
}

function liveTables(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function liveColumns(sqlite: Database.Database, table: string): LiveColumn[] {
  return (
    sqlite.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[]
  ).map((row) => ({
    name: row.name,
    type: row.type.toLowerCase(),
    notNull: row.notnull === 1,
    primaryKeyPosition: row.pk,
    hasDefault: row.dflt_value !== null,
  }));
}

function liveForeignKeys(sqlite: Database.Database, table: string): LiveForeignKey[] {
  const rows = sqlite.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all() as {
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string | null;
    on_update: string;
    on_delete: string;
  }[];

  // Rows of a multi-column key share an `id`; group so a compound key compares as
  // one constraint rather than as two halves.
  const byId = new Map<number, LiveForeignKey>();

  for (const row of [...rows].sort((a, b) => a.id - b.id || a.seq - b.seq)) {
    const existing = byId.get(row.id);

    if (existing === undefined) {
      byId.set(row.id, {
        columns: [row.from],
        refTable: row.table,
        refColumns: [row.to ?? 'rowid'],
        onDelete: row.on_delete.toLowerCase(),
        onUpdate: row.on_update.toLowerCase(),
      });
      continue;
    }

    existing.columns.push(row.from);
    existing.refColumns.push(row.to ?? 'rowid');
  }

  return [...byId.values()];
}

function liveIndexes(sqlite: Database.Database, table: string): LiveIndex[] {
  const list = sqlite.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all() as {
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }[];

  const ddl = new Map(
    (
      sqlite
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?")
        .all(table) as { name: string; sql: string | null }[]
    ).map((row) => [row.name, row.sql]),
  );

  return (
    list
      // `origin: 'c'` is "created by CREATE INDEX". `u` and `pk` are the implicit
      // indexes SQLite builds for UNIQUE and PRIMARY KEY clauses, which are already
      // compared through the column and constraint checks.
      .filter((row) => row.origin === 'c')
      .map((row) => {
        const columns = (
          sqlite.prepare(`PRAGMA index_info(${JSON.stringify(row.name)})`).all() as {
            seqno: number;
            name: string | null;
          }[]
        )
          .sort((a, b) => a.seqno - b.seqno)
          .map((c) => c.name ?? '<expression>');

        const sql = ddl.get(row.name) ?? '';
        const where = /\sWHERE\s+(.+)$/i.exec(sql);

        return {
          name: row.name,
          unique: row.unique === 1,
          columns,
          where: row.partial === 1 && where !== null ? normaliseSql(where[1]!) : null,
        };
      })
  );
}

/**
 * Named CHECK constraints, read out of the table's own DDL.
 *
 * No PRAGMA reports check constraints, so the text is all there is. The body is
 * taken by matching parentheses rather than by regex, because
 * `activity_system_actor_check` contains nested ones and a greedy or lazy pattern
 * gets a different half of it each way.
 */
function liveChecks(sqlite: Database.Database, table: string): LiveCheck[] {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { sql: string } | undefined;

  if (row === undefined) return [];

  const checks: LiveCheck[] = [];
  const pattern = /CONSTRAINT\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+CHECK\s*\(/gi;

  for (let match = pattern.exec(row.sql); match !== null; match = pattern.exec(row.sql)) {
    let depth = 1;
    let i = match.index + match[0].length;

    while (i < row.sql.length && depth > 0) {
      if (row.sql[i] === '(') depth += 1;
      else if (row.sql[i] === ')') depth -= 1;
      i += 1;
    }

    checks.push({
      name: match[1]!,
      expression: normaliseSql(row.sql.slice(match.index + match[0].length, i - 1)),
    });
  }

  return checks;
}

/**
 * Describe how two CHECK bodies differ.
 *
 * A closed vocabulary produces a twenty-value `IN (…)` list, and printing both
 * sides in full buries one changed word in four hundred characters. When both
 * sides are that shape, report the difference instead — which is the whole
 * actionable content.
 */
function describeCheckDifference(declaredExpr: string, liveExpr: string): string {
  const literals = (expression: string): string[] =>
    [...expression.matchAll(/'([^']*)'/g)].map((m) => m[1]!);

  // Both sides are already normalised — lower case, no whitespace — so a
  // substring test is exact here.
  const isInList = declaredExpr.includes('in(') && liveExpr.includes('in(');

  if (isInList) {
    const inDeclared = literals(declaredExpr);
    const inLive = literals(liveExpr);
    const added = inDeclared.filter((v) => !inLive.includes(v));
    const removed = inLive.filter((v) => !inDeclared.includes(v));

    if (added.length > 0 || removed.length > 0) {
      const parts = [
        added.length > 0
          ? `schema.ts allows ${added.map((v) => `"${v}"`).join(', ')} and the migrations do not`
          : '',
        removed.length > 0
          ? `the migrations allow ${removed.map((v) => `"${v}"`).join(', ')} and schema.ts does not`
          : '',
      ].filter((part) => part !== '');

      return parts.join('; ');
    }
  }

  return `schema.ts says ${declaredExpr}, migrations say ${liveExpr}`;
}

beforeAll(() => {
  // A database built from the migrations, nothing else. No pre-existing file, no
  // network, no `drizzle-kit push`.
  t = freshDb();
  declared = declaredSchema();
});
afterAll(() => {
  t.close();
});

describe('the two readers see something (AC4)', () => {
  it('finds tables on both sides', () => {
    // If either walker came back empty every comparison below would pass while
    // proving nothing, so this is asserted before anything is compared.
    expect(declared.size).toBeGreaterThanOrEqual(18);
    expect(liveTables(t.sqlite).length).toBeGreaterThanOrEqual(18);
  });

  it('reads foreign keys, indexes and checks out of the running database', () => {
    expect(liveForeignKeys(t.sqlite, 'tasks').length).toBeGreaterThanOrEqual(4);
    expect(liveIndexes(t.sqlite, 'sprints').map((i) => i.name)).toContain(
      'sprints_one_active_per_project',
    );
    expect(liveChecks(t.sqlite, 'activity').map((c) => c.name)).toContain('activity_type_check');
  });
});

describe('every declared table exists, and vice versa', () => {
  it('declares nothing the migrations did not create', () => {
    const live = new Set(liveTables(t.sqlite));

    const missing = [...declared.keys()]
      .filter((name) => !live.has(name))
      .map((name) => `schema.ts declares table "${name}" — the migrations never create it`);

    expect(missing).toEqual([]);
  });

  it('creates nothing the declaration does not mention', () => {
    const extra = liveTables(t.sqlite)
      .filter((name) => !declared.has(name))
      .map(
        (name) =>
          `the migrations create table "${name}" — schema.ts does not declare it, so drizzle-kit would try to drop it`,
      );

    expect(extra).toEqual([]);
  });
});

describe('columns agree on type, nullability and primary key (AC2)', () => {
  it('matches column for column', () => {
    const problems: string[] = [];

    for (const [name, table] of declared) {
      const live = new Map(liveColumns(t.sqlite, name).map((c) => [c.name, c]));

      for (const column of table.columns) {
        const actual = live.get(column.name);

        if (actual === undefined) {
          problems.push(`${name}.${column.name}: schema.ts declares it, the migrations do not`);
          continue;
        }

        if (actual.type !== column.type) {
          problems.push(
            `${name}.${column.name}: schema.ts says type "${column.type}", migrations say "${actual.type}"`,
          );
        }

        if (actual.notNull !== column.notNull) {
          problems.push(
            `${name}.${column.name}: schema.ts says notNull=${String(column.notNull)}, migrations say ${String(actual.notNull)}`,
          );
        }

        if (actual.hasDefault !== column.hasDefault) {
          problems.push(
            `${name}.${column.name}: schema.ts says hasDefault=${String(column.hasDefault)}, migrations say ${String(actual.hasDefault)}`,
          );
        }
      }

      for (const column of live.keys()) {
        if (!table.columns.some((c) => c.name === column)) {
          problems.push(
            `${name}.${column}: the migrations create it, schema.ts does not declare it`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('agrees on which columns are the primary key', () => {
    const problems: string[] = [];

    for (const [name, table] of declared) {
      const live = liveColumns(t.sqlite, name);
      const livePk = live
        .filter((c) => c.primaryKeyPosition > 0)
        .sort((a, b) => a.primaryKeyPosition - b.primaryKeyPosition)
        .map((c) => c.name);

      const declaredPk =
        table.compositePrimaryKey ?? table.columns.filter((c) => c.primaryKey).map((c) => c.name);

      if (declaredPk.join(',') !== livePk.join(',')) {
        problems.push(
          `${name}: schema.ts says primary key (${declaredPk.join(', ')}), migrations say (${livePk.join(', ')})`,
        );
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('foreign-key actions agree — these are the ones with teeth (AC2)', () => {
  it('matches every reference and its ON DELETE / ON UPDATE', () => {
    const problems: string[] = [];
    const key = (fk: { columns: string[]; refTable: string }): string =>
      `${fk.columns.join('+')}→${fk.refTable}`;

    for (const [name, table] of declared) {
      const live = new Map(liveForeignKeys(t.sqlite, name).map((fk) => [key(fk), fk]));

      for (const fk of table.foreignKeys) {
        const actual = live.get(key(fk));

        if (actual === undefined) {
          problems.push(
            `${name}.${fk.columns.join('+')} → ${fk.refTable}: declared in schema.ts, absent from the migrations`,
          );
          continue;
        }

        if (actual.onDelete !== fk.onDelete) {
          // The LAI-050 near-miss: `set null` in the migrations, `cascade` in the
          // declaration, and deleting a sprint would have destroyed its tasks.
          problems.push(
            `${name}.${fk.columns.join('+')} → ${fk.refTable}: schema.ts says ON DELETE ${fk.onDelete}, migrations say ${actual.onDelete}`,
          );
        }

        if (actual.onUpdate !== fk.onUpdate) {
          problems.push(
            `${name}.${fk.columns.join('+')} → ${fk.refTable}: schema.ts says ON UPDATE ${fk.onUpdate}, migrations say ${actual.onUpdate}`,
          );
        }

        if (actual.refColumns.join(',') !== fk.refColumns.join(',')) {
          problems.push(
            `${name}.${fk.columns.join('+')} → ${fk.refTable}: schema.ts references (${fk.refColumns.join(', ')}), migrations reference (${actual.refColumns.join(', ')})`,
          );
        }
      }

      for (const [k, fk] of live) {
        if (!table.foreignKeys.some((declaredFk) => key(declaredFk) === k)) {
          problems.push(
            `${name}.${fk.columns.join('+')} → ${fk.refTable}: created by the migrations, not declared in schema.ts`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('indexes agree, including unique and partial ones (AC2)', () => {
  it('matches name, uniqueness, columns and any WHERE clause', () => {
    const problems: string[] = [];

    for (const [name, table] of declared) {
      const live = new Map(liveIndexes(t.sqlite, name).map((index) => [index.name, index]));

      for (const index of table.indexes) {
        const actual = live.get(index.name);

        if (actual === undefined) {
          problems.push(
            `${name}: schema.ts declares index "${index.name}", the migrations do not create it`,
          );
          continue;
        }

        if (actual.unique !== index.unique) {
          problems.push(
            `index "${index.name}": schema.ts says unique=${String(index.unique)}, migrations say ${String(actual.unique)}`,
          );
        }

        if (actual.columns.join(',') !== index.columns.join(',')) {
          problems.push(
            `index "${index.name}": schema.ts says (${index.columns.join(', ')}), migrations say (${actual.columns.join(', ')})`,
          );
        }

        if (actual.where !== index.where) {
          problems.push(
            `index "${index.name}": schema.ts says WHERE ${index.where ?? '<none>'}, migrations say WHERE ${actual.where ?? '<none>'}`,
          );
        }
      }

      for (const indexName of live.keys()) {
        if (!table.indexes.some((index) => index.name === indexName)) {
          problems.push(
            `${name}: the migrations create index "${indexName}", schema.ts does not declare it`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('check constraints agree, body and all', () => {
  it('matches every named CHECK', () => {
    const problems: string[] = [];

    for (const [name, table] of declared) {
      const live = new Map(liveChecks(t.sqlite, name).map((check) => [check.name, check]));

      for (const check of table.checks) {
        const actual = live.get(check.name);

        if (actual === undefined) {
          problems.push(
            `${name}: schema.ts declares CHECK "${check.name}", the migrations do not have it`,
          );
          continue;
        }

        if (actual.expression !== check.expression) {
          // This is the shape that keeps recurring: a closed vocabulary grows in
          // `enums.ts`, the CHECK is not rebuilt, and writing the new value fails
          // at runtime with a constraint violation nobody predicted.
          problems.push(
            `CHECK "${check.name}": ${describeCheckDifference(check.expression, actual.expression)}`,
          );
        }
      }

      for (const checkName of live.keys()) {
        if (!table.checks.some((check) => check.name === checkName)) {
          problems.push(
            `${name}: the migrations have CHECK "${checkName}", schema.ts does not declare it`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
