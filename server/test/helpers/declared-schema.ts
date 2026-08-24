import { getTableConfig, SQLiteSyncDialect, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import * as schemaModule from '../../src/db/schema.ts';

/**
 * One reader for what `src/db/schema.ts` **declares** (LAI-061).
 *
 * Two drift checks depend on this and they must not disagree about what the
 * declaration says: `schema-spec-drift.test.ts` compares it upward against SPEC
 * §4, and `schema-migration-drift.test.ts` compares it downward against a
 * database built from the migrations. Together they close the chain
 * SPEC → `schema.ts` → migrations → database, and a second, slightly different
 * notion of "what schema.ts says" in the middle would break the chain quietly.
 *
 * It **runs** the declaration rather than parsing it: `getTableConfig` reports the
 * columns, keys, indexes and checks Drizzle will actually emit, so a column that
 * exists only in a comment does not count and a `.notNull()` cannot hide in a
 * chain.
 *
 * What it deliberately does not cover: **triggers**. Drizzle has no way to declare
 * one, so `activity`'s append-only triggers exist only in the migrations and
 * cannot be compared against anything here. They are guarded instead by LAI-044's
 * test, which tries an `UPDATE` and a `DELETE` and expects both to fail — the
 * right shape for a guarantee no declaration mentions.
 */

const dialect = new SQLiteSyncDialect();

export interface DeclaredColumn {
  name: string;
  /** `text`, `integer`, … as Drizzle will render it. */
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  hasDefault: boolean;
}

export interface DeclaredForeignKey {
  columns: string[];
  refTable: string;
  refColumns: string[];
  /** Normalised to lower case; `no action` when unset, as SQLite reports it. */
  onDelete: string;
  onUpdate: string;
}

export interface DeclaredIndex {
  name: string;
  unique: boolean;
  columns: string[];
  /** The `WHERE` of a partial index, normalised; `null` for a full one. */
  where: string | null;
}

export interface DeclaredCheck {
  name: string;
  /** The constraint body, normalised — see `normaliseSql`. */
  expression: string;
}

export interface DeclaredTable {
  name: string;
  columns: DeclaredColumn[];
  foreignKeys: DeclaredForeignKey[];
  indexes: DeclaredIndex[];
  checks: DeclaredCheck[];
  /** Column names of a composite primary key, or `null` when there is none. */
  compositePrimaryKey: string[] | null;
}

/**
 * Compare SQL by meaning rather than by formatting.
 *
 * Drizzle writes `status = 'active'` and the migration stores
 * `` `status` = 'active' ``; both are the same predicate. Whitespace goes
 * entirely — `IN ('a', 'b')` and `IN('a','b')` must not be a drift report —
 * and identifier quoting is stripped, so only the substance is left. String
 * literals keep their quotes, which is what makes an enum value change visible.
 */
export function normaliseSql(sql: string): string {
  return sql.replace(/[`"]/g, '').replace(/\s+/g, '').toLowerCase();
}

function render(value: SQL): string {
  return dialect.sqlToQuery(value).sql;
}

/** `undefined` means "unset", which SQLite reports as `NO ACTION`. */
function action(value: string | undefined): string {
  return (value ?? 'no action').toLowerCase();
}

export function declaredSchema(): Map<string, DeclaredTable> {
  const tables = new Map<string, DeclaredTable>();

  for (const value of Object.values(schemaModule)) {
    // A plain loop rather than `filter` with a type predicate: narrowing the union
    // of concrete table types to the generic `SQLiteTable` is not assignable under
    // `exactOptionalPropertyTypes`.
    if (!(value instanceof SQLiteTable)) continue;

    const config = getTableConfig(value);

    const columns: DeclaredColumn[] = config.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType().toLowerCase(),
      notNull: column.notNull,
      primaryKey: column.primary,
      hasDefault: column.hasDefault,
    }));

    const foreignKeys: DeclaredForeignKey[] = config.foreignKeys.map((fk) => {
      const reference = fk.reference();

      return {
        columns: reference.columns.map((c) => c.name),
        refTable: getTableConfig(reference.foreignTable).name,
        refColumns: reference.foreignColumns.map((c) => c.name),
        onDelete: action(fk.onDelete),
        onUpdate: action(fk.onUpdate),
      };
    });

    const indexes: DeclaredIndex[] = config.indexes.map((index) => {
      const c = index.config;

      return {
        name: c.name,
        unique: c.unique === true,
        columns: (c.columns ?? []).map((column) =>
          'name' in column ? String(column.name) : normaliseSql(render(column)),
        ),
        where: c.where === undefined ? null : normaliseSql(render(c.where)),
      };
    });

    const checks: DeclaredCheck[] = config.checks.map((check) => ({
      name: check.name,
      expression: normaliseSql(render(check.value)),
    }));

    const composite = config.primaryKeys[0];

    tables.set(config.name, {
      name: config.name,
      columns,
      foreignKeys,
      indexes,
      checks,
      compositePrimaryKey:
        composite === undefined ? null : composite.columns.map((column) => column.name),
    });
  }

  return tables;
}
