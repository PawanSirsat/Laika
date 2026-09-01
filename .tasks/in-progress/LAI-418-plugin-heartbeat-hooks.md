---
id: LAI-418
title: Plugin hooks — heartbeat on session start, stop, and a timer
area: plugin
assignee: shell
priority: p1
depends-on: [LAI-417]
discovered-from:
started: 2026-09-01T14:05:00+05:30
status: in-progress
---

## Goal

`plugin/hooks/hooks.json` is `{}` today, with a comment saying *"empty by design
until M4"*. This is M4.

Three hooks (SPEC §8): **`SessionStart`**, **`Stop`**, and a **throttled
`PostToolUse`** firing at most every 5 minutes while a session is active. Each
posts `{ repo, branch }` to `$LAIKA_URL/api/v1/heartbeats` with
`Authorization: Bearer $LAIKA_TOKEN`.

## Acceptance criteria

- [ ] All three hooks are registered and fire. The `PostToolUse` one is
      **throttled to at most once per 5 minutes** — a hook on every tool call
      would post hundreds of times an hour.
- [ ] **`|| true` on every hook, and it is not decoration.** SPEC §8: *"A board
      that is down, slow, or unreachable must never break a coding session."*
      **Prove it**: point `LAIKA_URL` at a dead port and confirm a session starts,
      runs and stops normally. Put the result in your log — this is the criterion
      most likely to be assumed rather than tested.
- [ ] **Unconfigured is silent, not broken.** With `LAIKA_URL` or `LAIKA_TOKEN`
      absent the hooks do nothing and say nothing. The plugin must load cleanly
      when unconfigured (§8); a hook that logs a warning on every session start
      of every repo that does not use Laika is a defect.
- [ ] `repo` is **`git config --get remote.origin.url` verbatim** — not the
      basename, not `owner/name`, not stripped of `.git`. **Do not parse it.**
      Normalising is the server's job (**D-043**, LAI-144): the server is the only
      side that can be fixed after a plugin ships, and a plugin that
      half-normalises invents a form the server has to guess at. `branch` is the
      current branch. Both resolved without failing when there is no remote, no
      branch, or no git repo at all — degrade to skipping the post, never to an
      error.
- [ ] A short timeout on the request. A board that hangs must not hang the hook.
- [ ] **No secret is committed.** `LAIKA_URL` and `LAIKA_TOKEN` come from the
      environment; anything committed carries an obviously-placeholder value.
- [ ] `plugin/hooks/README.md` no longer says "empty by design until M4", and
      **states the exact form `repo` is sent in**, with an example. Today it says
      *"git remote"*, which is the sentence that produced LAI-144 — a reader
      implementing a second client cannot tell from it whether to send a URL or
      `owner/name`, and the two do not match each other.
- [ ] Full gate green.

## Notes

No new dependencies. Shell and `curl`, as §8's snippet shows.

**Verify against a real board**, not only a dead one: post a heartbeat from a
real session and confirm the row exists. That is half of M4's exit criterion.

---

## CHIEF note — 2026-09-01

**AC4 was wrong when I wrote it.** It said the *"git remote basename"*, which is
a fifth form (`Laika`, or `Laika.git`) matching neither §4.3's `owner/name` nor
anything the server will parse. Building it as written would have produced
exactly the defect LAI-144 describes, in new code, on the same day the defect was
filed. Corrected above under **D-043**.

**No dependency on LAI-144.** A heartbeat whose `repo` resolves to no project
still records — §9.2 says it degrades — so this task is testable and shippable
before the server-side parser exists. Its own AC ("post a heartbeat from a real
session and confirm the row exists") is satisfied either way. What needs LAI-144
is §9.3 presence being non-empty, and that is LAI-144's criterion, not this one.

Two hard parts here are the two most likely to be assumed: **`|| true` proven
against a dead port**, and **silence when unconfigured**. Both are stated as
criteria because both are invisible when they fail — a hook that breaks a session
breaks it in someone else's repo, and a hook that warns on every session start
warns on every repo that has never heard of Laika.
