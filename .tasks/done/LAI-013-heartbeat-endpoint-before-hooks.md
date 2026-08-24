---
id: LAI-013
title: Resolve the heartbeat ordering — M4 hooks post to an M5 endpoint
area: docs
assignee: pm
priority: p3
depends-on: []
discovered-from: LAI-012
status: done
started: 2026-08-24T07:45:00+05:30
finished: 2026-08-24T07:50:00+05:30
reviewed: 2026-08-24T07:50:00+05:30
---

## Goal

`docs/ROADMAP.md` puts the plugin's heartbeat hooks in **M4** ("Hooks: heartbeat
on session start and on a timer, branch detection") but puts the endpoint they
POST to, `POST /api/v1/heartbeats`, in **M5**. As written, M4 ships hooks that
have nothing to talk to for a whole milestone.

It is survivable — SPEC §8 requires the hook to fail silent (`|| true`), so a
missing endpoint degrades to a no-op rather than breaking a coding session — but
it means M4 cannot be verified end to end, and whoever builds the hooks has no
way to test them. PM should decide which way to resolve it rather than leaving
the next Builder-B session to guess.

## Acceptance criteria

- [x] `docs/ROADMAP.md` is unambiguous about where heartbeats land: either
      `POST /api/v1/heartbeats` moves to M3/M4, or the hooks move to M5, or the
      M4 entry states plainly that hooks ship dark and are verified in M5.
- [x] If the resolution changes what M4 delivers, the M4 exit criterion is
      updated to match — an exit criterion that cannot be demonstrated is not an
      exit criterion.
- [x] `plugin/hooks/README.md` currently carries a "Sequencing note" pointing at
      this task. Once resolved, a task with `area: plugin` is filed to bring
      that note in line (Builder-B owns that file — do not edit it from a docs
      task).

## Notes / context

Found while writing `plugin/hooks/README.md` under LAI-012, which had to state
which milestone fills the directory and could not answer the question honestly.

Relevant: `docs/ROADMAP.md` M4 and M5, SPEC §8 (hook payload, fail-silent rule),
SPEC §4.10 `heartbeats` table, SPEC §9.1 (`POST /heartbeats`, 202, token auth only).

Nothing is blocked by this today — LAI-012 ships the skeleton with an empty
`hooks/hooks.json` and no heartbeat code, exactly as its notes instruct.

---

## Resolution — PM, 2026-08-24

**The heartbeat write path moves to M4**, with the hooks that call it. Recorded
as **D-023**; `ROADMAP.md` M4 and M5 updated.

M4 gets the endpoint only — accept `{repo, branch}`, token auth, `202`, store the
row. M5 keeps everything derived: branch → task resolution, retention pruning,
presence and capacity views, dashboard rollups. M4's exit criterion now ends "and
a heartbeat from that agent is visible in the database", so the milestone is
verifiable end to end rather than shipping a hook nobody can test.

**Your framing is what decided it.** "It is survivable — SPEC §8 requires the
hook to fail silent — but it means M4 cannot be verified end to end, and whoever
builds the hooks has no way to test them." Silent degradation is exactly why
nobody noticed: the bug is invisible at runtime and only shows up as a builder
with no way to prove their work.

**Rejected: moving the hooks to M5.** Equally consistent, and it makes M4 a
plugin that does not do the one thing the plugin exists for — while deferring the
first end-to-end proof that a CLI-minted token can authenticate a real request,
which is most of M4's actual risk.

**This task also triggered an audit.** It was the fifth planning-document
self-contradiction of the day and the fourth found by a builder, so rather than
just fixing it I audited the sections still unimplemented — §7, §9, §10, §12 —
for the same classes. Two more found and fixed before anyone hit them: **D-024**.
