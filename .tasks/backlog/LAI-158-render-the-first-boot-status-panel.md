---
id: LAI-158
title: Render the first-boot status panel from real values
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-206]
discovered-from: LAI-206
status: backlog
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

- [ ] `FirstBootScreen` renders `SystemStatus` from the `system` object on the
      status response. No literals.
- [ ] Both themes.
- [ ] The client type for the status response declares `system`, so the shape is
      checked rather than indexed into.
- [ ] **No total is displayed** — see the note below. `18 applied`, not `18/18`.
- [ ] A test that the panel renders the values it was given, and that no string
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
