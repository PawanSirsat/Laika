---
id: LAI-158
title: Render the first-boot status panel from real values
area: web
assignee: shell
priority: p3
depends-on: [LAI-206]
discovered-from: LAI-206
started: 2026-09-01T21:45:00+05:30
finished: 2026-09-01T22:15:00+05:30
status: done
---

## Goal

`SystemStatus` (LAI-021) exists, is styled and is tested. It has never been
rendered, because there was nothing real to feed it — LAI-106 AC5 ruled that
hardcoded numbers on a status panel are worse than no panel, so LAI-106 left it
out rather than invent them.

**LAI-206 provides the data.** `GET /api/v1/setup/status` now returns:

```json
{
  "setup_required": true,
  "system": {
    "database": "SQLite · WAL",
    "migrations_applied": 18,
    "smtp_configured": false
  }
}
```

Reachable **before** setup, which is the one screen it is for.

## Acceptance criteria

- [x] `FirstBootScreen` renders `SystemStatus` from the `system` object on the
      status response. No literals.
- [x] Both themes.
- [x] The client type for the status response declares `system`, so the shape is
      checked rather than indexed into.
- [x] **No total is displayed** — see the note below. `18 applied`, not `18/18`.
- [x] A test that the panel renders the values it was given, and that no string
      from the response body other than these three reaches the DOM.

## Notes

**`SystemStatus.tsx` takes `migrationsApplied`, `migrationsTotal` and
`smtpConfigured` — and there is no total to give it.** That is deliberate, not a
gap in LAI-206.

§6.4's payload carries `migrations_applied` alone, and the reason is checkable:
`server/src/index.ts` runs `runMigrations(db)` at line 30 and `serve()` at line
60, and the migrator throws rather than continuing. **A server that can answer
this request has applied all of them** — the denominator is always the numerator.
A `18/18` that can never read anything else is decoration with a chance of being
wrong, which is the exact failure LAI-106 AC5 named.

So the component's `migrationsTotal` prop should go, or become optional and
unrendered. **Do not pass `migrationsApplied` twice to make the slash appear.**

The design's `postgres 16 · connected` is an artifact (D-001,
`docs/design/README.md`). The `database` string comes from the live connection's
PRAGMAs, so it says `SQLite · WAL` because that is what the instance is.


---

## Submitted — SHELL, 2026-09-01

Root gate `EXIT 0` — **1831** server, **644** web, 49 cli, zero
`Unhandled|Errors|Failed|not ok`. Five mutations, all red.

`SystemStatus` had been built, styled and tested since LAI-021 and **never
rendered**. It renders now, from `system` on the status response — the type
LAI-160 declared for exactly this.

### The literal that was there all along

AC1 says *no literals*, and the one that mattered was not a number: the panel
drew **`sqlite · wal`** as a hardcoded string, justified in its own docblock by
*"a process serving this page has already opened the database"*. **That is true
and it does not say what the journal mode is.** The string comes from the live
connection's PRAGMAs now, so the panel names what the instance *is* rather than
what somebody typed — and D-001's rule no longer needs the component to enforce
it.

Before the response lands the panel is **absent**, not guessed. Same reason.

### Two tests pinned the mechanism, and updating them is the finding

Both failed the moment the value became real, and neither was wrong about the
criterion:

- *"the status panel never says Postgres"* also asserted `/sqlite/i` **against
  the source**. Reading the engine from the response removes that literal, so the
  test failed for the change that satisfied it more strongly. It now asserts
  `system.database` is read **and** that no engine name is quoted — the property,
  in both directions.
- *"migration and SMTP state are props, not fixtures"* required `migrationsTotal`
  in the source, which LAI-158 deliberately removes.

**Same shape as `href={route.path}` in LAI-423 and `routesInGroup(group)` in
LAI-413** — a test that names the implementation passes until the implementation
improves. Third instance in this repo, so worth saying again.

### No total, and it is asserted twice

`18 applied`, not `18/18`. `index.ts` runs the migrator before it binds the port
and the migrator throws rather than continuing, so a denominator could never
differ from the numerator — decoration with a chance of being wrong, which is
LAI-106 AC5's failure. A mutation reintroducing it as *the same number twice*
goes red, in the source and on the page.

### AC5's second half needed a browser

*"No string from the response body other than these three reaches the DOM"* is a
claim about what a reader sees. A source assertion can say `system.database`
appears in the file; it cannot say `setup_required` does not appear on the
screen. Four browser tests, both themes.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` — 1836 server, **644** web, 49 cli. Five
mutations, all red.

### What AC1 was really about was not a number

The panel drew **`sqlite · wal`** as a hardcoded string, **defended in its own
docblock**: *"a process serving this page has already opened the database"*.

> *"**True, and it does not say what the journal mode is.**"*

**A comment that is true and does not support its conclusion** — the fourth
instance this week, and the first in the *client*. The panel now names what the
instance **is**, and **D-001's rule no longer needs the component to enforce
it**, because the server cannot report Postgres.

**Absent before the response lands, not guessed** — *"it is read precisely when
somebody is checking whether something is wrong."*

### Two tests failed for the change that satisfied them

- *"the status panel never says Postgres"* also asserted **`/sqlite/i` against the
  source**. Its stated criterion is that the panel names the engine it uses, and
  **reading it from the instance satisfies that far better while removing the
  literal the assertion was looking for.** *"It failed in the direction of the
  improvement."*
- *"migration and SMTP state are props, not fixtures"* required `migrationsTotal`
  in the source — **which this task deliberately deletes.**

**Third instance here**, after `href={route.path}` and `routesInGroup(group)`:
**a test that names the implementation passes until the implementation
improves.** Both rewritten to assert the property in both directions.

**And the observation about why this one was lucky is the useful half:**

> *"The first two were caught in review and this one was caught by the suite
> going red — which is the good case, but **only because the mechanism happened
> to be load-bearing. A pinned mechanism that is merely *equivalent* would have
> failed for nothing.**"*

That is the cost of pinning an implementation stated precisely: **it fails
loudly when the implementation improves, and silently when it does not matter.**

### AC5's second half is why a browser test exists

*"No string from the response body other than these three reaches the DOM."*
**A source assertion can say `system.database` appears in the file; it cannot say
`setup_required` does not appear on the screen.** Four tests, both themes,
including the absent-panel case.

**And no total, asserted twice** — in the source and on the page — with a
mutation reintroducing it as *the same number printed twice* going red. That is
exactly the shape LAI-206's Notes warned about, caught by the guard rather than
by somebody remembering.
