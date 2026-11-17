---
id: LAI-1304
title: 'Off-host database backups: copy the nightly SQLite snapshot into the configured object store'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-1300]
discovered-from: LAI-1300
status: backlog
---

## Goal

The owner asked for the database as "a separate resource"; Laika's database is SQLite (D-001),
so the closest useful thing is getting its backups off the box. When the store is configured,
the nightly `backup.snapshot` (§11.6) also uploads the snapshot to a `backups/` prefix (or a
separate bucket) with the same retention, and the operations doc says how to restore from it.

## Acceptance criteria

- [ ] Upload after each nightly snapshot when the store is configured; retention matches §11.6.
- [ ] Restore drill in `docs/OPERATIONS.md` from a stored snapshot.
