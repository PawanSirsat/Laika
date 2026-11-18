---
id: LAI-1325
title: 'laika activity works on a machine set up by device pairing (no personal token)'
area: cli
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-11-18T07:07:54Z
finished: 2026-11-18T07:29:51Z
---

## Goal

Found on Ksage, 2026-11-18. Board card LAIKA-1095.

Savita set up her laptop the documented way: Add device, then `laika device pair`, then
`laika tool add`. `laika activity on` then says *"This machine is not connected to a board (no
LAIKA_URL / LAIKA_TOKEN)"*.

**The cause:** `findCredentials` and `credentialsFor` (`cli/src/activity-sync.ts`) read only
`LAIKA_URL` and `LAIKA_TOKEN`, from three places:

- the environment;
- `~/.claude/settings.json`'s `env`;
- `~/.laika/env`.

The device-pair path writes none of those (`install.sh --no-credential`), so activity can't
work on any machine set up the current way. The workaround today is a personal token in
`~/.laika/env`.

**The fix:** when no personal token exists, activity uses this machine's own connection. That
covers `on`, `status`, `sync`, `backfill` and the hook-launched sync.

**The credential:** the device credential, or a tool's own credential in
`~/.laika/agents/<tool>.json`, whichever the board accepts for `GET`/`PUT /me/local-activity`
and the OTLP metrics route.

**If the board refuses** agent or device tokens on those routes (D-102: *"a token cannot turn
it on"*), stop and settle the right credential with CHIEF. Don't widen the policy.

**The error message** names the real fix, not `laika init`.

Scope: area `cli`, plus whatever server route turns out to be needed (CHIEF, 2026-11-18).

## Acceptance criteria

- [x] On a machine set up only by `device pair` and `tool add`, `laika activity on`, `status`
      and `sync` work against a board with Developer insights on.
- [x] Tests cover a fixture home directory with no `~/.laika/env`.
- [x] A personal token, where present, still works as today.
- [x] The README's activity section describes the device path.

## Notes

- **Testing on Belka:** single test files only; CI runs the gate.
- **Where it stops:** at a green PR. CHIEF merges.
