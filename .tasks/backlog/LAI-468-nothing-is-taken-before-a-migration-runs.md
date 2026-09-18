---
id: LAI-468
title: 'Nothing is taken before a migration runs — M7 asks for migration safety on boot'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-466]
discovered-from: LAI-466
status: backlog
---

## Goal

M7 lists **"migration safety on boot"** and `runMigrations` has none:

```ts
export function runMigrations(db: Db, migrationsFolder = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
  ensureActivityTriggers(db);
  backfillTaskTimestamps(db);
}
```

**`backup.ts` takes a nightly snapshot on a schedule, and nothing takes one before
a schema change.** The riskiest moment in a self-hosted product's life is the
first boot after an upgrade, and it is the one moment with no fresh copy behind
it. **LAI-466 proved a snapshot restores; this makes sure there is one to
restore.**

## Acceptance criteria

- [ ] **A snapshot is taken before any pending migration is applied**, and **only
      when there is one** — an unchanged schema on every restart must not fill the
      backup directory and push the fourteen real ones out. **Assert both:** a
      boot with pending migrations writes one, a boot without writes none.
- [ ] **A failed migration leaves the pre-migration snapshot in place and says
      where it is.** The operator is reading a crash log at that moment; the path
      goes in the error, not only in the directory.
- [ ] **`backfillTaskTimestamps` runs after the snapshot too.** It is not a `.sql`
      migration, but it writes, and *"idempotent by construction"* is a property of
      today's implementation rather than of the step.
- [ ] **The pre-migration snapshot is named so it sorts and reads distinctly**
      from a nightly one. §11.6 keeps fourteen by filename order; **a pre-upgrade
      copy that a nightly prune can delete is the one you wanted.** Decide whether
      it is exempt from the count and say which.
- [ ] **Test the failure, not only the success.** A migration that throws
      half-way, with the snapshot then restored and the app booted from it —
      LAI-466's harness already does the last two steps.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**SQLite's DDL is transactional, so a failed migration usually rolls back** —
which is exactly why this is worth doing carefully rather than assuming it is
covered. **`migrate()` applies files in sequence**, so three of five succeeding
and the fourth failing leaves a database that is neither version. **The snapshot
is for that case, not for the single-statement one.**

**Do not add a `--no-backup` flag.** An operator who wants to skip it can move the
directory; a flag is a thing that ends up in a systemd unit and is forgotten.
